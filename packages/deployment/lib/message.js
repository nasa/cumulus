'use strict';

const get = require('lodash.get');
const isObject = require('lodash.isobject');
const isString = require('lodash.isstring');
const omit = require('lodash.omit');
const { deprecate } = require('@cumulus/common/util');

/**
 * Because both kes and message adapter use Mustache for templating,
 * we add curly brackets to items that are using the [$] and {$} syntax
 * to produce {{$}} and {[$]}
 *
 * @param {Object} cumulusConfig - the CumulusConfig portion of a task definition
 * @returns {Object} updated CumulusConfig
 */
function fixCumulusMessageSyntax(cumulusConfig) {
  if (!cumulusConfig) return {};
  deprecate('CumulusConfig', '1.15.0', 'AWS Parameters with task_config');
  const test = new RegExp('^([\\{]{1}|[\\[]{1})(\\$.*)([\\]]{1}|[\\}]{1})$');

  Object.keys(cumulusConfig).forEach((n) => {
    if (isObject(cumulusConfig[n])) {
      // eslint-disable-next-line no-param-reassign
      cumulusConfig[n] = fixCumulusMessageSyntax(cumulusConfig[n]);
    } else if (isString(cumulusConfig[n])) {
      const match = cumulusConfig[n].match(test);
      if (match) {
        // eslint-disable-next-line no-param-reassign
        cumulusConfig[n] = `{${match[0]}}`;
      }
    }
  });

  return cumulusConfig;
}


/**
 * Extracts Cumulus Configuration from each Step Function Workflow
 * and returns it as a separate object
 *
 * @param {Object} config - Kes config object
 * @returns {Object} updated kes config object
 */
function extractCumulusConfigFromSF(config) {
  const workflowConfigs = {};

  // loop through the message adapter config of each step of
  // the step function, add curly brackets to values
  // with dollar sign and remove config key from the
  // definition, otherwise CloudFormation will be mad
  // at us.
  Object.keys(config.stepFunctions).forEach((name) => {
    const sf = config.stepFunctions[name];
    workflowConfigs[name] = {};
    Object.keys(sf.States).forEach((n) => {
      workflowConfigs[name][n] = fixCumulusMessageSyntax(sf.States[n].CumulusConfig);
      sf.States[n] = omit(sf.States[n], ['CumulusConfig']);
    });
    // eslint-disable-next-line no-param-reassign
    config.stepFunctions[name] = sf;
  });

  // eslint-disable-next-line no-param-reassign
  config.workflowConfigs = workflowConfigs;
  if (Object.keys(workflowConfigs)) deprecate('CumulusConfig', '1.15.0', 'AWS Parameters with task_config');
  return config;
}

/**
 * Returns the OutputValue of a CloudFormation Output
 *
 * @param {Object} outputs - list of CloudFormation Outputs
 * @param {string} key - the key to return the value of
 *
 * @returns {string} the output value
 */
function findOutputValue(outputs, key) {
  const output = outputs.find((o) => (o.OutputKey === key));
  if (output) return output.OutputValue;
  return undefined;
}

/**
 * Generates a universal Cumulus Message template for a Cumulus Workflow
 *
 * @param {Object} config - Kes config object
 * @param {Array} outputs - an list of CloudFormation outputs
 *
 * @returns {Object} a Cumulus Message template
 */
function generateWorkflowTemplate(config, outputs) {
  // get cmr password from outputs
  const cmrPassword = findOutputValue(outputs, 'EncryptedCmrPassword');
  const cmr = Object.assign({}, config.cmr, { password: cmrPassword });
  // get launchpad passphrase from outputs
  const launchpadPassphrase = findOutputValue(outputs, 'EncryptedLaunchpadPassphrase');
  const launchpad = Object.assign({}, config.launchpad, { passphrase: launchpadPassphrase });
  const bucket = get(config, 'system_bucket');

  // add queues
  const queues = {};
  const queueExecutionLimits = {};
  if (config.sqs) {
    const queueArns = outputs.filter((o) => o.OutputKey.includes('SQSOutput'));

    queueArns.forEach((queue) => {
      const queueName = queue.OutputKey.replace('SQSOutput', '');
      const queueUrl = queue.OutputValue;

      queues[queueName] = queueUrl;

      const maxExecutions = get(config.sqs, `${queueName}.maxExecutions`);
      if (maxExecutions) {
        queueExecutionLimits[queueName] = maxExecutions;
      }
    });
  }

  const template = {
    cumulus_meta: {
      message_source: 'sfn',
      system_bucket: bucket,
      state_machine: null,
      execution_name: null,
      workflow_start_time: null
    },
    meta: {
      workflow_name: null,
      workflow_tasks: {},
      stack: config.stackName,
      buckets: config.buckets,
      cmr,
      launchpad,
      distribution_endpoint: config.distribution_endpoint,
      collection: {},
      provider: {},
      template: `s3://${bucket}/${config.stack}/workflow_template.json`,
      queues,
      queueExecutionLimits
    },
    payload: {},
    exception: null
  };

  return template;
}

/**
 * Generate a Cumulus Message templates for all the workflows
 * in the stack and upload to s3
 *
 * @param {Object} config - Kes config object
 * @param {Array} outputs - an list of CloudFormation outputs
 * @param {function} uploader - an uploader function
 *
 * @returns {Promise} undefined
 */
async function generateTemplates(config, outputs, uploader) {
  // this function only works if there are step functions defined in the deployment
  if (config.stepFunctions) {
    const bucket = config.system_bucket;
    const stack = config.stackName;

    // generate workflow message template and upload it to s3.
    const template = generateWorkflowTemplate(config, outputs);
    console.log('Uploading Cumulus Universal Workflow Message Template ...');
    const key = `${stack}/workflow_template.json`;
    await uploader(bucket, key, JSON.stringify(template));

    // generate list of workflows and upload it to S3
    // this is used by the /workflows endpoint of the API to return list
    // of existing workflows
    const workflowUploads = Object.keys(config.stepFunctions).map((name) => {
      const arn = findOutputValue(outputs, `${name}StateMachine`);
      return uploader(bucket, `${stack}/workflows/${name}.json`, JSON.stringify({
        name,
        arn,
        definition: config.stepFunctions[name]
      }));
    });
    await Promise.all(workflowUploads);

    // upload the buckets config
    await uploader(bucket, `${stack}/workflows/buckets.json`, JSON.stringify(config.buckets));
  }
}

module.exports = {
  fixCumulusMessageSyntax,
  extractCumulusConfigFromSF,
  findOutputValue,
  generateWorkflowTemplate,
  generateTemplates
};
