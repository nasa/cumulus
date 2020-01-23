'use strict';

const AWS = require('aws-sdk');
const isObject = require('lodash.isobject');
const isString = require('lodash.isstring');
const moment = require('moment');

const Lambda = require('@cumulus/aws-client/Lambda');
const SQSUtils = require('@cumulus/aws-client/SQS');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const aws = require('@cumulus/common/aws');
const { deprecate } = require('@cumulus/common/util');

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
 * @param {string} executionArn - execution ARN
 * @returns {string} return aws console url for the execution
 */
function getExecutionUrl(executionArn) {
  deprecate('@cumulus/ingest/aws/getExecutionUrl', '1.17.0', '@cumulus/aws-client/StepFunctions.getExecutionUrl');
  return StepFunctions.getExecutionUrl(executionArn);
}

function invoke(name, payload, type = 'Event') {
  deprecate('@cumulus/ingest/aws/invoke', '1.17.0', '@cumulus/aws-client/Lambda.invoke');
  return Lambda.invoke(name, payload, type);
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
  static getUrl(name) {
    deprecate('@cumulus/ingest/aws/SQS.getUrl', '1.17.0', '@cumulus/aws-client/SQS.getQueueUrlByName');
    return SQSUtils.getQueueUrlByName(name);
  }

  static deleteQueue(queueUrl) {
    deprecate('@cumulus/ingest/aws/SQS.deleteQueue', '1.17.0', '@cumulus/aws-client/SQS.deleteQueue');
    return SQSUtils.deleteQueue(queueUrl);
  }

  static receiveMessage(queueUrl, numOfMessages = 1, timeout = 30) {
    deprecate('@cumulus/ingest/aws/SQS.receiveMessage', '1.17.0', '@cumulus/aws-client/SQS.receiveSQSMessages');
    return SQSUtils.sendSQSMessage(queueUrl, {
      numOfMessages,
      visibilityTimeout: timeout
    });
  }

  static sendMessage(queueUrl, message) {
    deprecate('@cumulus/ingest/aws/SQS.sendMessage', '1.17.0', '@cumulus/aws-client/SQS.sendSQSMessage');
    return SQSUtils.sendSQSMessage(queueUrl, message);
  }

  static deleteMessage(queueUrl, receiptHandle) {
    deprecate('@cumulus/ingest/aws/SQS.deleteMessage', '1.17.0', '@cumulus/aws-client/SQS.deleteSQSMessage');
    return SQSUtils.deleteSQSMessage(queueUrl, receiptHandle);
  }

  static attributes(name) {
    deprecate('@cumulus/ingest/aws/SQS.attributes', '1.17.0', '@cumulus/aws-client/SQS.getQueueAttributes');
    return SQSUtils.getQueueAttributes(name);
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
  static async getExecutionStatus(executionArn) {
    deprecate('@cumulus/ingest/aws/StepFunction.getExecutionStatus', '1.17.0', '@cumulus/aws-client/StepFunction.getExecutionStatus');
    return StepFunctions.getExecutionStatus(executionArn);
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
}

module.exports = {
  CloudWatch,
  SQS,
  ECS,
  invoke,
  getEndpoint,
  Events,
  StepFunction,
  getExecutionUrl
};
