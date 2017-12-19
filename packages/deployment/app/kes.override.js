/* eslint-disable no-console */
'use strict';

const { Kes, Lambda } = require('kes');
const forge = require('node-forge');
const utils = require('kes').utils;

/**
 * Generates a public/private key pairs
 * @function generateKeyPair
 * @return {object} a forge pki object
 */
function generateKeyPair() {
  const rsa = forge.pki.rsa;
  console.log('Generating keys. It might take a few seconds!');
  return rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
}

/**
 * Generates a template used for SFScheduler to create cumulus
 * payloads for step functions. Each step function gets a separate
 * template
 *
 * @function generateInputTemplates
 * @param  {object} config Kes Config Object
 * @param  {array} outputs Array of CloudFormation outputs
 * @return {array} list of templates
 */
function generateInputTemplates(config, outputs) {
  const template = {
    eventSource: 'sfn',
    resources: {},
    ingest_meta: {},
    provider: {},
    collection: {},
    meta: {},
    exception: null,
    payload: {}
  };

  const arns = {};
  outputs.forEach((o) => {
    arns[o.OutputKey] = o.OutputValue;
  });

  template.resources = {
    stack: config.stackName,
    kms: arns.KmsKeyId,
    cmr: config.cmr,
    distribution_endpoint: config.distribution_endpoint
  };

  // add cmr password:
  template.resources.cmr.password = arns.EncryptedCmrPassword;

  if (config.buckets) {
    template.resources.buckets = config.buckets;
  }

  if (config.sqs) {
    template.resources.queues = {};
    Object.keys(config.sqs).forEach((queue) => {
      const queueUrl = arns[`${queue}SQSOutput`];
      if (queueUrl) {
        template.resources.queues[queue] = queueUrl;
      }
    });
  }

  if (config.stepFunctions) {
    const sfs = {};
    config.stepFunctions.forEach((sf) => {
      sfs[sf.name] = `s3://${config.buckets.internal}/` +
                     `${config.stackName}/workflows/${sf.name}.json`;
    });

    template.resources.templates = sfs;
  }

  const inputs = [];

  // generate a output template for each workflow
  if (config.stepFunctions) {
    config.stepFunctions.forEach((sf) => {
      const t = Object.assign({}, template);
      t.ingest_meta = {
        topic_arn: arns.sftrackerSnsArn,
        state_machine: arns[`${sf.name}StateMachine`],
        workflow_name: sf.name,
        status: 'running',
        config: sf.config
      };
      inputs.push(t);
    });
  }

  return inputs;
}

/**
 * Generate a list of workflows (step functions) that are uploaded to S3. This
 * list is used by the Cumulus Dashboard to show the workflows.
 *
 * @function generateWorkflowsList
 * @param  {object} config Kes Config object
 * @return {array} Array of objects that include workflow name, template s3 uri and definition
 */
function generateWorkflowsList(config) {
  const workflows = [];
  if (config.stepFunctions) {
    config.stepFunctions.forEach((sf) => {
      workflows.push({
        name: sf.name,
        template: `s3://${config.buckets.internal}/${config.stackName}/workflows/${sf.name}.json`,
        definition: sf.definition
      });
    });

    return workflows;
  }

  return false;
}


class UpdatedLambda extends Lambda {
  /**
   * Copy source code of a given lambda function, zips it, calculate
   * the hash of the source code and updates the lambda object with
   * the hash, local and remote locations of the code
   *
   * @param {Object} lambda the lambda object
   * @returns {Promise} returns the updated lambda object
   */
  zipLambda(lambda) {
    console.log(`Zipping ${lambda.local} and injecting sled`);
    return utils.zip(lambda.local, [lambda.source, this.config.sled]).then(() => {
      return lambda;
    });
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
   * @param  {object} config Kes Config object
   * @return {Promise}
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

      const clusters = resources.filter(item => {
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
   * Uploads the generated private and public key pair
   *
   * @param  {string} bucket the bucket to upload the keys to
   * @param  {string} key    the key (folder) to use for the uploaded files
   * @return {Promise} aws promise of the upload to s3
   */
  uploadKeyPair(bucket, key) {
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

    return this.s3.putObject(params1).promise()
      .then(() => this.s3.putObject(params2).promise())
      .then(() => console.log('keys uploaded to S3'));
  }

  /**
   * Checks if the private/public key exists. If not
   * generate and upload them
   *
   * @return {Promise}
   */
  crypto() {
    const key = `${this.stack}/crypto`;

    // check if files are generated
    return this.s3.headObject({
      Key: `${key}/public.pub`,
      Bucket: this.bucket
    }).promise()
      .then(() => this.s3.headObject({
        Key: `${key}/public.pub`,
        Bucket: this.bucket
      }).promise())
      .catch(() => this.uploadKeyPair(this.bucket, key));
  }

  /**
   * Override opsStack method.
   *
   * @return {Promise}
   */
  opsStack() {
    // check if public and private key are generated
    // if not generate and upload them
    const apis = {};

    return this.crypto(this.bucket, this.stack)
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

        const workflowInputs = generateInputTemplates(this.config, outputs);
        const stackName = this.stack;

        console.log('Uploading Workflow Input Templates');
        const uploads = workflowInputs.map((w) => {
          const workflowName = w.ingest_meta.workflow_name;
          const key = `${stackName}/workflows/${workflowName}.json`;
          return this.uploadToS3(
            this.bucket,
            key,
            JSON.stringify(w)
          );
        });

        const workflows = generateWorkflowsList(this.config);

        if (workflows) {
          uploads.push(this.uploadToS3(
            this.bucket,
            `${stackName}/workflows/list.json`,
            JSON.stringify(workflows)
          ));
        }

        return Promise.all(uploads);
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

module.exports = UpdatedKes;
