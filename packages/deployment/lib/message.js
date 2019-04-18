'use strict';

const get = require('lodash.get');
const isObject = require('lodash.isobject');
const isString = require('lodash.isstring');
const omit = require('lodash.omit');

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
 * Generates a Cumulus Message template for a Cumulus Workflow
 *
 * @param {string} name - name of the workflow
 * @param {Object} workflow - the Step Function workflow object
 * @param {Object} config - Kes config object
 * @param {Array} outputs - an list of CloudFormation outputs
 *
 * @returns {Object} a Cumulus Message template
 */
function template(name, workflow, config, outputs) {
  // get cmr password from outputs
  const cmrPassword = findOutputValue(outputs, 'EncryptedCmrPassword');
  const cmr = Object.assign({}, config.cmr, { password: cmrPassword });
  const bucket = get(config, 'system_bucket');

  // add the sns topic arn used for monitoring workflows
  const topicArn = findOutputValue(outputs, 'sftrackerSnsArn');

  // add the current workflows' state machine arn
  const stateMachineArn = findOutputValue(outputs, `${name}StateMachine`);

  // add queues
  const queues = {};
  if (config.sqs) {
    const queueArns = outputs.filter((o) => o.OutputKey.includes('SQSOutput'));

    queueArns.forEach((queue) => {
      queues[queue.OutputKey.replace('SQSOutput', '')] = queue.OutputValue;
    });
  }

  // add the cumulus message config of the current workflow
  const workflowConfig = {};
  const states = get(workflow, 'States', {});
  Object.keys(states).forEach((state) => {
    workflowConfig[state] = config.workflowConfigs[name][state];
  });

  // add the s3 uri to all the workflow templates for the current stack
  const templatesUris = {};
  const stepFunctions = get(config, 'stepFunctions', {});
  Object.keys(stepFunctions).forEach((sf) => {
    templatesUris[sf] = `s3://${bucket}/${config.stack}/workflows/${sf}.json`;
  });

  const t = {
    cumulus_meta: {
      message_source: 'sfn',
      system_bucket: bucket,
      state_machine: stateMachineArn,
      execution_name: null,
      workflow_start_time: null
    },
    meta: {
      workflow_name: name,
      workflow_tasks: {},
      stack: config.stackName,
      buckets: config.buckets,
      cmr: cmr,
      distribution_endpoint: config.distribution_endpoint,
      topic_arn: topicArn,
      collection: {},
      provider: {},
      templates: templatesUris,
      queues
    },
    workflow_config: workflowConfig,
    payload: {},
    exception: null
  };

  return t;
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
    const templates = Object.keys(config.stepFunctions)
      .map((name) => template(name, config.stepFunctions[name], config, outputs));

    // uploads the generated templates to S3
    const workflows = [];
    console.log('Uploading Cumulus Message Templates for each Workflow ...');
    for (let ctr = 0; ctr < templates.length; ctr += 1) {
      const t = templates[ctr];
      const name = t.meta.workflow_name;
      const key = `${stack}/workflows/${name}.json`;
      await uploader(bucket, key, JSON.stringify(t)); // eslint-disable-line no-await-in-loop
      workflows.push({
        name,
        template: `s3://${bucket}/${key}`,
        definition: config.stepFunctions[name]
      });
    }

    // generate list of workflows and upload it to S3
    // this is used by the /workflows endpoint of the API to return list
    // of existing workflows
    await uploader(bucket, `${stack}/workflows/list.json`, JSON.stringify(workflows));

    // upload the buckets config
    await uploader(bucket, `${stack}/workflows/buckets.json`, JSON.stringify(config.buckets));
  }
}

module.exports = {
  fixCumulusMessageSyntax,
  extractCumulusConfigFromSF,
  findOutputValue,
  template,
  generateTemplates
};
