'use strict';

const isObject = require('lodash.isobject');
const isString = require('lodash.isstring');
const aws = require('@cumulus/common/aws');
const AWS = require('aws-sdk');
const moment = require('moment');
const log = require('@cumulus/common/log');
const { inTestMode } = require('@cumulus/common/test-utils');

/**
 * getEndpoint returns proper AWS arguments for various
 * AWS classes to use. It is primarily intended for cases when
 * running an AWS service locally. For example, it sets the correct
 * endpoint for a dynamoDB table running locally and so on
 *
 * @param {boolean} [local] whether this is a local run
 * @param {number} [port=8000] port number defaults to 8000
 * @returns {object} the options for AWS service classes
 */

function getEndpoint(local = false, port = 8000) {
  const args = {};
  if (process.env.IS_LOCAL === 'true' || local) {
    // use dummy access info
    AWS.config.update({
      accessKeyId: 'myKeyId',
      secretAccessKey: 'secretKey',
      region: 'us-east-1'
    });
    args.endpoint = new AWS.Endpoint(`http://localhost:${port}`);
    return args;
  }

  if (process.env.AWS_DEFAULT_REGION) {
    AWS.config.update({ region: process.env.AWS_DEFAULT_REGION });
  }

  return args;
}

/**
 * Returns execution ARN from a statement machine Arn and executionName
 *
 * @param {string} stateMachineArn -  state machine ARN
 * @param {string} executionName - state machine's execution name
 * @returns {string} Step Function Execution Arn
 */
function getExecutionArn(stateMachineArn, executionName) {
  if (stateMachineArn && executionName) {
    const sfArn = stateMachineArn.replace('stateMachine', 'execution');
    return `${sfArn}:${executionName}`;
  }
  return null;
}

/**
 * Returns execution ARN from a statement machine Arn and executionName
 *
 * @param {string} executionArn - execution ARN
 * @returns {string} return aws console url for the execution
 */
function getExecutionUrl(executionArn) {
  const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
  return `https://console.aws.amazon.com/states/home?region=${region}`
         + `#/executions/details/${executionArn}`;
}

async function invoke(name, payload, type = 'Event') {
  if (process.env.IS_LOCAL || inTestMode()) {
    log.info(`Faking Lambda invocation for ${name}`);
    return false;
  }

  const lambda = new AWS.Lambda();

  const params = {
    FunctionName: name,
    Payload: JSON.stringify(payload),
    InvocationType: type
  };

  log.info(`invoked ${name}`);
  return lambda.invoke(params).promise();
}


/**
 * sqs class instance generator
 *
 * @param {boolean} local Whether this is a local call
 * @returns {object} Returns a instance of aws SQS class
 */

function sqs(local) {
  return new AWS.SQS(getEndpoint(local, 9324));
}

class Events {
  static async putEvent(name, schedule, state, description = null, role = null) {
    const cwevents = new AWS.CloudWatchEvents();

    const params = {
      Name: name,
      Description: description,
      RoleArn: role,
      ScheduleExpression: schedule,
      State: state
    };

    return cwevents.putRule(params).promise();
  }

  static async deleteEvent(name) {
    const cwevents = new AWS.CloudWatchEvents();

    const params = {
      Name: name
    };

    return cwevents.deleteRule(params).promise();
  }

  static async deleteTarget(id, rule) {
    const cwevents = new AWS.CloudWatchEvents();
    const params = {
      Ids: [id],
      Rule: rule
    };

    return cwevents.removeTargets(params).promise();
  }

  static async putTarget(rule, id, arn, input) {
    const cwevents = new AWS.CloudWatchEvents();

    const params = {
      Rule: rule,
      Targets: [ /* required */
        {
          Arn: arn,
          Id: id,
          Input: input
        }
      ]
    };

    return cwevents.putTargets(params).promise();
  }
}

class SQS {
  static async getUrl(name) {
    const queue = sqs();
    const u = await queue.getQueueUrl({ QueueName: name }).promise();
    return u.QueueUrl;
  }

  static async deleteQueue(queueUrl) {
    const queue = sqs();
    const params = {
      QueueUrl: queueUrl
    };

    return queue.deleteQueue(params).promise();
  }

  static async receiveMessage(queueUrl, numOfMessages = 1, timeout = 30) {
    const queue = sqs();
    const params = {
      QueueUrl: queueUrl,
      AttributeNames: ['All'],
      VisibilityTimeout: timeout,
      MaxNumberOfMessages: numOfMessages
    };

    const messages = await queue.receiveMessage(params).promise();

    // convert body from string to js object
    if (Object.prototype.hasOwnProperty.call(messages, 'Messages')) {
      messages.Messages.forEach((mes) => {
        mes.Body = JSON.parse(mes.Body); // eslint-disable-line no-param-reassign
      });

      return messages.Messages;
    }
    return [];
  }

  static async sendMessage(queueUrl, message) {
    let messageBody;
    if (isString(message)) {
      messageBody = message;
    }
    else if (isObject(message)) {
      messageBody = JSON.stringify(message);
    }
    else {
      throw new TypeError('body type is not accepted');
    }

    const params = {
      MessageBody: messageBody,
      QueueUrl: queueUrl
    };

    const queue = sqs();
    return queue.sendMessage(params).promise();
  }

  static async deleteMessage(queueUrl, receiptHandle) {
    const queue = sqs();
    const params = {
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle
    };

    return queue.deleteMessage(params).promise();
  }

  static async attributes(name) {
    const u = await this.getUrl(name);
    const queue = sqs();
    const params = {
      AttributeNames: ['All'],
      QueueUrl: u
    };

    const attr = await queue.getQueueAttributes(params).promise();
    attr.Attributes.name = name;
    return attr.Attributes;
  }
}


class ECS {
  static ecs(local) {
    return new AWS.ECS(getEndpoint(local, 9324));
  }

  constructor(cluster) {
    this.cluster = cluster || process.env.ECS_CLUSTER;
    this.ecs = this.constructor.ecs();
  }

  async describeCluster() {
    const params = {
      clusters: [this.cluster]
    };

    return this.ecs.describeClusters(params).promise();
  }

  async listServices() {
    const params = { cluster: this.cluster };
    return this.ecs.listServices(params).promise();
  }

  async describeServices(services) {
    const params = { services, cluster: this.cluster };
    return this.ecs.describeServices(params).promise();
  }

  async listInstances() {
    return this.ecs.listContainerInstances({ cluster: this.cluster }).promise();
  }

  async describeInstances(instances) {
    const params = {
      cluster: this.cluster,
      containerInstances: instances
    };
    return this.ecs.describeContainerInstances(params).promise();
  }
}


class CloudWatch {
  static cw() {
    return new AWS.CloudWatch();
  }

  /**
   * Return the bucket size using information provided by the CloudWatch
   *
   * Example return object:
   * ```
   * {
   *    Timestamp: 2017-04-23T17:39:00.000Z,
   *    Sum: 4809568606909,
   *    Unit: 'Bytes',
   *    bucket: 'cumulus-internal'
   * }
   * ```
   *
   * @param {string} bucketName - Name of the bucket to get the size
   * @returns {Object} Retuns total storage for a given bucket
   */
  static async bucketSize(bucketName) {
    AWS.config.update({ region: process.env.AWS_DEFAULT_REGION });
    const cw = this.cw();

    const params = {
      EndTime: moment().unix(),
      MetricName: 'BucketSizeBytes',
      Namespace: 'AWS/S3',
      Period: 3600 * 24, // 24 hours
      StartTime: moment().subtract(5, 'day').unix(),
      Dimensions: [
        {
          Name: 'BucketName',
          Value: bucketName
        },
        {
          Name: 'StorageType',
          Value: 'StandardStorage'
        }
      ],
      Statistics: [
        'Sum'
      ]
    };

    const response = await cw.getMetricStatistics(params).promise();

    // return the latest number
    const sorted = response.Datapoints.sort((a, b) => {
      const time1 = moment(a.Timestamp).unix();
      const time2 = moment(b.Timestamp).unix();

      return time1 > time2 ? -1 : 1;
    });

    sorted[0].bucket = bucketName;
    return sorted[0];
  }
}

class StepFunction {
  static async getExecutionStatus(arn) {
    const sfn = new AWS.StepFunctions();

    const [execution, executionHistory] = await Promise.all([
      this.getExecution(arn),
      this.getExecutionHistory(arn)
    ]);

    const stateMachine = await sfn.describeStateMachine({
      stateMachineArn: execution.stateMachineArn
    }).promise();

    return { execution, executionHistory, stateMachine };
  }

  static async getExecutionHistory(arn) {
    const sfn = new AWS.StepFunctions();

    const params = {
      executionArn: arn
    };

    const execution = await sfn.getExecutionHistory(params).promise();
    return execution;
  }

  /**
   * Push an event to S3 if the length of the event is greater than 32000 bytes
   *
   * The event must have the following properties:
   * - resources.stack
   * - ingest_meta.execution_name
   *
   * @param {Object} event - an event to be pushed to S3
   * @returns {Promise.<Object>} - a Promise that resoles to an Object with an
   *   s3_path property indicating where the event was pushed to
   */
  static pushEvent(event) {
    const str = JSON.stringify(event);

    if (str.length <= 32000) return Promise.resolve(event);

    const stack = event.meta.stack;
    const name = event.cumulus_meta.execution_name;
    const key = `${stack}/payloads/${name}.json`;
    const bucket = event.cumulus_meta.system_bucket;

    return aws.s3().putObject({
      Bucket: bucket,
      Key: key,
      Body: str
    }).promise()
      .then(() => ({ s3_path: `s3://${bucket}/${key}` }));
  }

  static async stop(arn, cause, error) {
    const stepfunctions = new AWS.StepFunctions();
    return stepfunctions.stopExecution({
      executionArn: arn,
      cause: cause,
      error: error
    }).promise();
  }
}

module.exports = {
  CloudWatch,
  SQS,
  ECS,
  invoke,
  getEndpoint,
  Events,
  StepFunction,
  getExecutionArn,
  getExecutionUrl
};
