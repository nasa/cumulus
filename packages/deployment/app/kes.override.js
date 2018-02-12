/* eslint-disable no-console, no-param-reassign */
/**
 * This module override the Kes Class and the Lambda class of Kes
 * to support specific needs of the Cumulus Deployment.
 *
 * In Specific, this module change the default Kes Deployment in the following ways:
 *
 * - Adds the ability to add Cumulus Configuration for each Step Function Task
 *    - @fixCumulusMessageSyntax
 *    - @extractCumulusConfigFromSF
 * - Generates a public and private key to encrypt private information
 *    - @generateKeyPair
 *    - @uploadKeyPair
 *    - @crypto
 * - Creates Cumulus Message Templates for each Step Function Workflow
 * - Adds Cumulus Message Adapter code to any Lambda Function that uses it
 * - Uploads the public/private keys and the templates to S3
 * - Restart Existing ECS tasks after each deployment
 * - Redeploy API Gateway endpoints after Each Deployment
 *
 */
'use strict';

const { Kes, Lambda } = require('kes');
const fs = require('fs-extra');
const path = require('path');
const omit = require('lodash.omit');
const forge = require('node-forge');
const utils = require('kes').utils;
const request = require('request');
const extract = require('extract-zip');


/**
 * Because both kes and message adapter use Mustache for templating,
 * we add curly brackes to items that are using the [$] and {$} syntax
 * to produce {{$}} and {[$]}
 *
 * @param {Object} cumulusConfig - the CumulusConfig portion of a task definition
 * @returns {Object} updated CumulusConfig
 */
function fixCumulusMessageSyntax(cumulusConfig) {
  const test = new RegExp('^([\\{]{1}|[\\[]{1})(\\$\\..*)([\\]]{1}|[\\}]{1})$');
  if (cumulusConfig) {
    Object.keys(cumulusConfig).forEach((n) => {
      if (typeof cumulusConfig[n] === 'object') {
        cumulusConfig[n] = fixCumulusMessageSyntax(cumulusConfig[n]);
      }
      else if (typeof cumulusConfig[n] === 'string') {
        const match = cumulusConfig[n].match(test);
        if (match) {
          cumulusConfig[n] = `{${match[0]}}`;
        }
      }
    });
  }
  else {
    cumulusConfig = {};
  }
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
  // defintion, otherwise CloudFormation will be mad
  // at us.
  Object.keys(config.stepFunctions).forEach((name) => {
    const sf = config.stepFunctions[name];
    workflowConfigs[name] = {};
    Object.keys(sf.States).forEach((n) => {
      workflowConfigs[name][n] = fixCumulusMessageSyntax(sf.States[n].CumulusConfig);
      sf.States[n] = omit(sf.States[n], ['CumulusConfig']);
    });
    config.stepFunctions[name] = sf;
  });

  config.workflowConfigs = workflowConfigs;
  return config;
}

/**
 * Returns the OutputValue of a Cloudformation Outputs
 *
 * @param {Object} outputs - list of CloudFormation Outputs
 * @param {string} key - the key to return the value of
 *
 * @returns {string} the output value
 */
function findOutputValue(outputs, key) {
  return outputs.find((o) => (o.OutputKey === key)).OutputValue;
}

/**
 * Generates public/private key pairs
 *
 * @function generateKeyPair
 * @returns {Object} a forge pki object
 */
function generateKeyPair() {
  const rsa = forge.pki.rsa;
  console.log('Generating keys. It might take a few seconds!');
  return rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
}

/**
 * Genrates private/public keys and Upload them to a given bucket
 *
 * @param {string} bucket - the bucket to upload the keys to
 * @param {string} key - the key (folder) to use for the uploaded files
 * @param {Object} s3 - an instance of the AWS S3 class
 * @returns {Promise} undefined
 */
async function uploadKeyPair(bucket, key, s3) {
  const pki = forge.pki;
  const keyPair = generateKeyPair();
  console.log('Keys Generated');

  // upload the private key
  const privateKey = pki.privateKeyToPem(keyPair.privateKey);
  const params1 = {
    Bucket: bucket,
    Key: `${key}/private.pem`,
    ACL: 'private',
    Body: privateKey
  };

  // upload the public key
  const publicKey = pki.publicKeyToPem(keyPair.publicKey);
  const params2 = {
    Bucket: bucket,
    Key: `${key}/public.pub`,
    ACL: 'private',
    Body: publicKey
  };

  await s3.putObject(params1).promise();
  await s3.putObject(params2).promise();

  console.log('keys uploaded to S3');
}

/**
 * Checks if the private/public key exists. If not, it
 * generates and uploads them
 *
 * @param {string} stack - name of the stack
 * @param {string} bucket - the bucket to upload the keys to
 * @param {Object} s3 - an instance of AWS S3 class
 * @returns {Promise} undefined
 */
async function crypto(stack, bucket, s3) {
  const key = `${stack}/crypto`;

  // check if files are generated
  try {
    await s3.headObject({
      Key: `${key}/public.pub`,
      Bucket: bucket
    }).promise();

    await s3.headObject({
      Key: `${key}/public.pub`,
      Bucket: bucket
    }).promise();
  }
  catch (e) {
    await uploadKeyPair(bucket, key, s3);
  }
}

/**
 * Generates a Cumulus Message template for a Cumulus Workflow
 *
 * @param {string} name - name of the workflow
 * @param {Object} workflow - the Step Function workflow object
 * @param {Object} config - Kes config object
 * @param {Array} outputs - an list of Cloudformation outputs
 *
 * @returns {Object} a Cumulus Messge template
 */
function template(name, workflow, config, outputs) {
  // get cmr password from outputs
  const cmrPassword = findOutputValue(outputs, 'EncryptedCmrPassword');
  const cmr = Object.assign({}, config.cmr, { password: cmrPassword });

  // add the sns topic arn used for monitoring workflows
  const topicArn = findOutputValue(outputs, 'sftrackerSnsArn');

  // add the current workflows's state machine arn
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
  Object.keys(workflow.States).forEach((state) => {
    workflowConfig[state] = config.workflowConfigs[name][state];
  });

  // add the s3 uri to all the workflow templates for teh current stack
  const templatesUris = {};
  Object.keys(config.stepFunctions).forEach((sf) => {
    templatesUris[sf] = `s3://${config.buckets.internal}/${config.stack}/${sf}.json`;
  });

  const t = {
    cumulus_meta: {
      message_source: 'sfn',
      system_bucket: config.buckets.internal,
      state_machine: stateMachineArn,
      execution_name: null,
      workflow_start_time: null
    },
    meta: {
      workflow_name: name,
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
 * Generates a Cumulus Message templates for the all the workflows
 * in the stack and upload to s3
 *
 * @param {Object} config - Kes config object
 * @param {Array} outputs - an list of Cloudformation outputs
 * @param {function} uploader - an uploader function
 *
 * @returns {Promise} undefined
 */
async function generateTemplates(config, outputs, uploader) {
  fs.writeFileSync('config.json', JSON.stringify(config));
  fs.writeFileSync('outputs.json', JSON.stringify(outputs));

  // this function only works if there are step functions defined in the deployment
  if (config.stepFunctions) {
    const bucket = config.buckets.internal;
    const stack = config.stackName;
    const templates = Object.keys(config.stepFunctions)
      .map((name) => template(name, config.stepFunctions[name], config, outputs));

    // uploads the generated templates to S3
    const workflows = [];
    console.log('Uploading Workflow Input Templates');
    for (const t of templates) {
      const name = t.meta.workflow_name;
      const key = `${stack}/workflows/${name}.json`;
      await uploader(bucket, key, JSON.stringify(t));
      workflows.push({
        name,
        template: `s3://${bucket}/${key}`,
        definition: config.stepFunctions[name]
      });
    }

    // generate list of workflows and upload it to S3
    // this is used by the /workflows endpoint of the API to return list
    // of existing workflows
    await uploader(bucket, stack, `${stack}/workflows/list.json`, JSON.stringify(workflows));
  }
}

class UpdatedLambda extends Lambda {
  constructor(config) {
    super(config);
    this.config = config;
  }
  /**
   * Copy source code of a given lambda function, zips it, calculate
   * the hash of the source code and updates the lambda object with
   * the hash, local and remote locations of the code
   *
   * @param {Object} lambda - the lambda object
   * @returns {Promise} returns the updated lambda object
   */
  zipLambda(lambda) {
    let msg = `Zipping ${lambda.local}`;
    // skip if the file with the same hash is zipped
    if (fs.existsSync(lambda.local)) {
      return Promise.resolve(lambda);
    }
    const fileList = [lambda.source];

    if (lambda.useMessageAdapter) {
      const kesFolder = path.join(this.config.kesFolder, 'build', 'adapter');
      fileList.push(kesFolder);
      msg += ' and injecting message adapter';
    }

    console.log(`${msg} for ${lambda.name}`);

    return utils.zip(lambda.local, fileList).then(() => lambda);
  }

  buildS3Path(lambda) {
    lambda = super.buildS3Path(lambda);

    return lambda;
  }
}

/**
 * A subclass of Kes class that overrides opsStack method.
 * The subclass is checks whether the public/private keys are generated
 * and uploaded to the deployment bucket. If not, they are generated and
 * uploaded.
 *
 * After the successful deployment of a CloudFormation template, the subclass
 * generates and uploads payload and stepfunction templates and restart ECS
 * tasks if there is an active cluster with running tasks.
 *
 * @class UpdatedKes
 */
class UpdatedKes extends Kes {
  constructor(config) {
    super(config);
    this.Lambda = UpdatedLambda;
    this.messageAdapterGitPath = `${config.repo_owner}/${config.message_adapter_repo}`;
  }

  async redployApiGateWay(name, restApiId, stageName) {
    if (restApiId) {
      const apigateway = new this.AWS.APIGateway();
      const r = await apigateway.createDeployment({ restApiId, stageName }).promise();
      console.log(`${name} endpoints with the id ${restApiId} redeployed.`);
      return r;
    }
    return true;
  }

  /**
   * Restart all active tasks in the clusters of a deployed
   * cloudformation
   *
   * @param  {Object} config - Kes Config object
   * @returns {Promise} undefined
   */
  async restartECSTasks(config) {
    const ecs = new this.AWS.ECS();

    try {
      let resources = [];
      const params = { StackName: config.stackName };
      while (true) { // eslint-disable-line no-constant-condition
        const data = await this.cf.listStackResources(params).promise();
        resources = resources.concat(data.StackResourceSummaries);
        if (data.NextToken) params.NextToken = data.NextToken;
        else break;
      }

      const clusters = resources.filter((item) => {
        if (item.ResourceType === 'AWS::ECS::Cluster') return true;
        return false;
      });

      for (const cluster of clusters) {
        const tasks = await ecs.listTasks({ cluster: cluster.PhysicalResourceId }).promise();
        for (const task of tasks.taskArns) {
          console.log(`restarting ECS task ${task}`);
          await ecs.stopTask({
            task: task,
            cluster: cluster.PhysicalResourceId
          }).promise();
          console.log(`ECS task ${task} restarted`);
        }
      }
    }
    catch (err) {
      console.log(err);
    }
  }

  /**
   * `downloadZipfile` downloads zipfile from remote location and stores on disk
   *
   * @param {string} fileUrl - URL file location
   * @param {string} localFilename - Where to store file locally
   * @returns {Promise} undefinied
   */
  downloadZipfile(fileUrl, localFilename) {
    const file = fs.createWriteStream(localFilename);
    const options = {
      uri: fileUrl,
      headers: {
        Accept: 'application/octet-stream',
        'Content-Type': 'application/zip',
        'Content-Transfer-Encoding': 'binary'
      }
    };

    return new Promise((resolve, reject) => {
      request(options, (err) => {
        if (err) reject(err);
      })
      .pipe(file);

      file.on('finish', () => {
        console.log(`Completed download of ${fileUrl} to ${localFilename}`);
        resolve();
      })
      .on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * unzip a given zip file to the given destination
   *
   * @param {string} filename - the zip file to extract
   * @param {string} dst - the destination to extract the file
   * @returns {Promise} the path of the extracted zip
   */
  extractZipFile(filename, dst) {
    // create the destination folder it doesn't exist
    fs.mkdirpSync(dst);
    return new Promise((resolve, reject) => {
      extract(filename, { dir: dst }, (err) => {
        if (err) return reject(err);
        console.log(`${filename} extracted to ${dst}`);
        return resolve(dst);
      });
    });
  }

  /**
   * Fetches the latest release version of the cumulus message adapter
   *
   * @returns {Promise} Promise resolution is string of latest github release, e.g. 'v0.0.1'
   */
  fetchLatestMessageAdapterRelease() {
    const options = {
      url: `https://api.github.com/repos/${this.messageAdapterGitPath}/releases/latest`,
      headers: {
        Accept: 'application/json',
        'User-Agent': '@cumulus/deployment' // Required by Github API
      }
    };

    return new Promise((resolve, reject) => {
      request(options, (err, response, body) => {
        if (err) reject(err);
        resolve(JSON.parse(body).tag_name);
      });
    });
  }

  /**
   * Determine the version of the cumulus-message-adapter to use
   *
   * @returns {Promise.<string>} - the message adapter version
   */
  messageAdapterVersion() {
    if (this.config.message_adapter_version) {
      return Promise.resolve(this.config.message_adapter_version);
    }
    return this.fetchLatestMessageAdapterRelease();
  }

  /**
   * The Github URL of the cumulus-message-adapter zip file
   *
   * @returns {Promise.<string>} - the URL to fetch the cumulus-message-adapter from
   */
  messageAdapterUrl() {
    return this.messageAdapterVersion()
      .then((version) => `https://github.com/${this.messageAdapterGitPath}/releases/download/${version}/${this.config.message_adapter_filename}`); // eslint-disable-line max-len
  }

  /**
   * Determines which release version should be downloaded from
   * cumulus-message-adapter repository and then downloads that file.
   *
   * @returns {Promise} returns the path of the extracted message adapter or an empty response
   */
  fetchMessageAdapter() {
    if (!this.config.message_adapter_filename) return Promise.resolve();

    const messageAdapterFilename = this.config.message_adapter_filename;

    // Construct message adapter folder names
    const kesBuildFolder = path.join(this.config.kesFolder, 'build');

    const unzipFolderName = path.basename(messageAdapterFilename, '.zip');
    const adapterUnzipPath = path.join(process.cwd(), kesBuildFolder, 'adapter', unzipFolderName);

    const adapterZipPath = path.join(process.cwd(), kesBuildFolder, messageAdapterFilename);

    return this.messageAdapterUrl(messageAdapterFilename)
      .then((url) => this.downloadZipfile(url, adapterZipPath))
      .then(() => this.extractZipFile(adapterZipPath, adapterUnzipPath));
  }

  /**
   * Override CF compilation to inject Sled
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  compileCF() {
    // return Promise.resolve();
    return this.fetchMessageAdapter().then(() => super.compileCF());
  }

  /**
   * Override opsStack method.
   *
   * @returns {Promise} aws response
   */
  opsStack() {
    // check if public and private key are generated
    // if not generate and upload them
    const apis = {};

    // remove config variable from all workflow steps
    // and keep them in a separate variable.
    // this is needed to prevent stepfunction deployment from crashing
    this.config = extractCumulusConfigFromSF(this.config);

    return crypto(this.stack, this.bucket, this.s3)
      .then(() => super.opsStack())
      .then(() => this.describeCF())
      .then((r) => {
        const outputs = r.Stacks[0].Outputs;

        const urls = {
          Api: 'token',
          Distribution: 'redirect'
        };
        console.log('\nHere are the important URLs for this deployment:\n');
        outputs.forEach((o) => {
          if (Object.keys(urls).includes(o.OutputKey)) {
            console.log(`${o.OutputKey}: `, o.OutputValue);
            console.log('Add this url to URS: ', `${o.OutputValue}${urls[o.OutputKey]}`, '\n');

            if (o.OutputKey === 'Distribution') {
              this.config.distribution_endpoint = o.OutputValue;
            }
          }

          switch (o.OutputKey) {
            case 'ApiId':
              apis.api = o.OutputValue;
              break;
            case 'DistributionId':
              apis.distribution = o.OutputValue;
              break;
            case 'ApiStage':
              apis.stageName = o.OutputValue;
              break;
            default:
              //nothing
          }
        });

        return generateTemplates(this.config, outputs, this.uploadToS3.bind(this));
      })
      .then(() => this.restartECSTasks(this.config))
      .then(() => {
        const updates = [
          this.redployApiGateWay('api', apis.api, apis.stageName),
          this.redployApiGateWay('distribution', apis.distribution, apis.stageName)
        ];

        return Promise.all(updates);
      });
  }
}

// because commonjs does not support default export
// we have to add other functions as properties of the kes
// class to allow testing them with ava
UpdatedKes.template = template;
UpdatedKes.fixCumulusMessageSyntax = fixCumulusMessageSyntax;
UpdatedKes.extractCumulusConfigFromSF = extractCumulusConfigFromSF;
module.exports = UpdatedKes;
