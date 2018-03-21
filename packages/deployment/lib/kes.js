/* eslint-disable no-console, no-param-reassign */
/**
 * This module overrides the Kes Class and the Lambda class of Kes
 * to support specific needs of the Cumulus Deployment.
 *
 * Specifically, this module changes the default Kes Deployment in the following ways:
 *
 * - Adds the ability to add Cumulus Configuration for each Step Function Task
 *    - @fixCumulusMessageSyntax
 *    - @extractCumulusConfigFromSF
 * - Generates a public and private key to encrypt private information
 *    - @generateKeyPair
 *    - @uploadKeyPair
 *    - @crypto
 * - Creates Cumulus Message Templates for each Step Function Workflow
 *    - @template
 *    - @generateTemplates
 * - Adds Cumulus Message Adapter code to any Lambda Function that uses it
 * - Uploads the public/private keys and the templates to S3
 * - Restart Existing ECS tasks after each deployment
 * - Redeploy API Gateway endpoints after Each Deployment
 *
 */
'use strict';

const { Kes } = require('kes');
const path = require('path');
const Lambda = require('./lambda');
const { crypto } = require('./crypto');
const { fetchMessageAdapter } = require('./adapter');
const { extractCumulusConfigFromSF, generateTemplates } = require('./message');


/**
 * Makes setTimeout return a promise
 *
 * @param {integer} ms - number of milliseconds
 * @returns {Promise} the arguments passed after the timeout
 */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A subclass of Kes class that overrides opsStack method.
 * The subclass checks whether the public/private keys are generated
 * and uploaded to the deployment bucket. If not, they are generated and
 * uploaded.
 *
 * After the successful deployment of a CloudFormation template, the subclass
 * generates and uploads payload and StepFunction templates and restarts ECS
 * tasks if there is an active cluster with running tasks.
 *
 * @class UpdatedKes
 */
class UpdatedKes extends Kes {
  /**
   * Overrides the default constructor. It updates the default
   * Lambda class and adds a git repository path for the cumulus
   * message adapter
   *
   * @param {Object} config - kes config object
   */
  constructor(config) {
    super(config);
    this.Lambda = Lambda;
    this.messageAdapterGitPath = `${config.repo_owner}/${config.message_adapter_repo}`;
  }

  /**
   * Redeploy the given api gateway (more info: https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-deploy-api.html)
   *
   * @param {string} name - the name of the api gateway deployment (used for logging)
   * @param {string} restApiId - the api gateway id
   * @param {string} stageName - the deployment stage name
   * @returns {Promise.<boolean>} returns true if successful
   */
  async redeployApiGateWay(name, restApiId, stageName) {
    const waitTime = 20;
    if (restApiId) {
      try {
        const apigateway = new this.AWS.APIGateway();
        await apigateway.createDeployment({ restApiId, stageName }).promise();
        console.log(`${name} endpoints with the id ${restApiId} redeployed.`);
      }
      catch (e) {
        if (e.message && e.message.includes('Too Many Requests')) {
          console.log(
            `Redeploying ${restApiId} was throttled. ` +
            `Another attempt will be made in ${waitTime} seconds`
          );
          await delay(waitTime * 1000);
          return this.redeployApiGateWay(name, restApiId, stageName);
        }
        throw e;
      }
    }
    return true;
  }

  /**
   * Restart all active tasks in the clusters of a deployed
   * CloudFormation
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
   * Override CF compilation to inject cumulus message adapter
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  compileCF() {
    const filename = this.config.message_adapter_filename || '';
    const kesBuildFolder = path.join(this.config.kesFolder, 'build');
    const unzipFolderName = path.basename(filename, '.zip');

    const src = path.join(process.cwd(), kesBuildFolder, filename);
    const dest = path.join(process.cwd(), kesBuildFolder, 'adapter', unzipFolderName);

    // return Promise.resolve();
    return fetchMessageAdapter(
      this.config.message_adapter_version,
      this.messageAdapterGitPath,
      filename,
      src,
      dest
    ).then(() => super.compileCF());
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
    // this is needed to prevent StepFunction deployment from crashing
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
      .then(() => this.redeployApiGateWay('api', apis.api, apis.stageName))
      .then(() => this.redeployApiGateWay('distribution', apis.distribution, apis.stageName))
      .catch((e) => {
        console.log(e);
        throw e;
      });
  }
}

module.exports = UpdatedKes;
