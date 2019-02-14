'use strict';

const isObject = require('lodash.isobject');
const isString = require('lodash.isstring');
const url = require('url');
const aws = require('@cumulus/common/aws');
const StepFunctions = require('@cumulus/common/StepFunctions');
const AWS = require('aws-sdk');
const moment = require('moment');
const log = require('@cumulus/common/log');
const { deprecate } = require('@cumulus/common/util');
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

class S3 {
  static parseS3Uri(uri) {
    deprecate(
      '@cumulus/ingest/aws/S3.parseUri()',
      '1.10.2',
      '@cumulus/common/aws.parseS3Uri()'
    );

    const parsed = url.parse(uri);
    if (parsed.protocol !== 's3:') {
      throw new Error('uri must be a S3 uri, e.g. s3://bucketname');
    }

    return {
      Bucket: parsed.hostname,
      Key: parsed.path.substring(1)
    };
  }

  static async copy(source, dstBucket, dstKey, isPublic = false) {
    deprecate(
      '@cumulus/ingest/aws/S3.copy()',
      '1.10.2',
      '@cumulus/common/aws.s3CopyObject()'
    );

    const s3 = new AWS.S3();

    const params = {
      Bucket: dstBucket,
      CopySource: source,
      Key: dstKey,
      ACL: isPublic ? 'public-read' : 'private'
    };

    return s3.copyObject(params).promise();
  }

  static async list(bucket, prefix) {
    deprecate(
      '@cumulus/ingest/aws/S3.list()',
      '1.10.2',
      '@cumulus/common/aws.listS3ObjectsV2()'
    );

    const s3 = new AWS.S3();

    const params = {
      Bucket: bucket,
      Prefix: prefix
    };

    return s3.listObjectsV2(params).promise();
  }

  static async delete(bucket, key) {
    deprecate(
      '@cumulus/ingest/aws/S3.delete()',
      '1.10.2',
      '@cumulus/common/aws.deleteS3Object()'
    );

    const s3 = new AWS.S3();

    const params = {
      Bucket: bucket,
      Key: key
    };

    return s3.deleteObject(params).promise();
  }

  static async put(bucket, key, body, acl = 'private', meta = null) {
    deprecate(
      '@cumulus/ingest/aws/S3.put()',
      '1.10.2',
      '@cumulus/common/aws.s3PutObject()'
    );

    const params = {
      Bucket: bucket,
      Key: key,
      Body: body,
      ACL: acl
    };

    if (meta) {
      params.Metadata = meta;
    }

    return aws.s3().putObject(params).promise();
  }

  static async get(bucket, key) {
    deprecate(
      '@cumulus/ingest/aws/S3.get()',
      '1.10.2',
      '@cumulus/common/aws.getS3Object()'
    );

    const params = {
      Bucket: bucket,
      Key: key
    };

    return aws.s3().getObject(params).promise();
  }

  static async upload(bucket, key, body, acl = 'private') {
    deprecate(
      '@cumulus/ingest/aws/S3.upload()',
      '1.10.2',
      '@cumulus/common/aws.promiseS3Upload()'
    );

    const s3 = new AWS.S3();

    const params = {
      Bucket: bucket,
      Key: key,
      Body: body,
      ACL: acl
    };

    return s3.upload(params).promise();
  }

  /**
   * checks whether a file exists on S3
   *
   * @param {string} bucket S3 bucket name
   * @param {string} key S3 key: folder and file name
   * @returns {boolean} true if found / false if not found
   * @static
   */

  static async fileExists(bucket, key) {
    deprecate(
      '@cumulus/ingest/aws/S3.fileExists()',
      '1.10.2',
      '@cumulus/common/aws.fileExists()'
    );

    const s3 = new AWS.S3();
    try {
      const r = await s3.headObject({ Key: key, Bucket: bucket }).promise();
      return r;
    }
    catch (e) {
      // if file is not found download it
      if (e.stack.match(/(NotFound)/)) {
        return false;
      }
      throw e;
    }
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
  static async getExecution(executionArn, ignoreMissingExecutions = false) {
    deprecate(
      '@cumulus/ingest/aws/StepFunction.getExecution()',
      '1.10.2',
      '@cumulus/common/StepFunctions.describeExecution()'
    );

    try {
      return await StepFunctions.describeExecution({ executionArn });
    }
    catch (err) {
      if (ignoreMissingExecutions
        && err.message
        && err.message.includes('Execution Does Not Exist')) {
        return {
          executionArn,
          status: 'NOT_FOUND'
        };
      }
      throw err;
    }
  }

  static async getExecutionStatus(executionArn) {
    const sfn = new AWS.StepFunctions();

    const [execution, executionHistory] = await Promise.all([
      this.getExecution(executionArn),
      StepFunctions.getExecutionHistory({ executionArn })
    ]);

    const stateMachine = await sfn.describeStateMachine({
      stateMachineArn: execution.stateMachineArn
    }).promise();

    return { execution, executionHistory, stateMachine };
  }

  static async getExecutionHistory(executionArn) {
    deprecate(
      '@cumulus/ingest/aws/StepFunction.getExecutionHistory()',
      '1.11.1',
      '@cumulus/common/StepFunctions.getExecutionHistory()'
    );

    return StepFunctions.getExecutionHistory({ executionArn });
  }

  /**
   * Fetch an event from S3
   *
   * @param {Object} event - an event to be fetched from S3
   * @param {string} event.s3_path - the S3 location of the event
   * @returns {Promise.<Object>} - the parsed event from S3
   */
  static async pullEvent(event) {
    deprecate(
      '@cumulus/ingest/aws/StepFunction.pullEvent()',
      '1.10.4',
      '@cumulus/common/aws.pullStepFunctionEvent()'
    );

    if (event.s3_path) {
      const parsed = S3.parseS3Uri(event.s3_path);
      const file = await aws.getS3Object(parsed.Bucket, parsed.Key);

      return JSON.parse(file.Body.toString());
    }
    return event;
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
  S3,
  ECS,
  invoke,
  getEndpoint,
  Events,
  StepFunction,
  getExecutionArn,
  getExecutionUrl
};
