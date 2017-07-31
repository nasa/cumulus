'use strict';

import url from 'url';
import AWS from 'aws-sdk';
import moment from 'moment';
import log from './log';

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

export function getEndpoint(local = false, port = 8000) {
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

export async function invoke(name, payload, type = 'Event') {
  if (process.env.IS_LOCAL) {
    log.info(`Faking Lambda invocation for ${name}`);
    return;
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


export class S3 {
  static parseS3Uri(uri) {
    const parsed = url.parse(uri);
    if (parsed.protocol !== 's3:') {
      throw new Error('uri must be a S3 uri, e.g. s3://bucketname');
    }

    return {
      Bucket: parsed.hostname,
      Key: parsed.path
    };
  }

  static async copy(source, dstBucket, dstKey, isPublic = false) {
    const s3 = new AWS.S3();

    const params = {
      Bucket: dstBucket,
      CopySource: source,
      Key: dstKey,
      ACL: isPublic ? 'public-read' : 'private'
    };

    return s3.copyObject(params).promise();
  }

  static async delete(bucket, key) {
    const s3 = new AWS.S3();

    const params = {
      Bucket: bucket,
      Key: key
    };

    return s3.deleteObject(params).promise();
  }

  static async put(bucket, key, body, acl = 'private') {
    const s3 = new AWS.S3();

    const params = {
      Bucket: bucket,
      Key: key,
      Body: body,
      ACL: acl
    };

    return s3.putObject(params).promise();
  }

  static async get(bucket, key) {
    const s3 = new AWS.S3();

    const params = {
      Bucket: bucket,
      Key: key
    };

    return s3.getObject(params).promise();
  }

  static async upload(bucket, key, body, acl = 'private') {
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
    const s3 = new AWS.S3();
    try {
      await s3.headObject({ Key: key, Bucket: bucket }).promise();
      return true;
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


export class SQS {
  static async createQueue(name) {
    const queue = sqs();
    const params = {
      QueueName: name
    };

    return queue.createQueue(params).promise();
  }

  static async getUrl(name) {
    const queue = sqs();
    const u = await queue.getQueueUrl({ QueueName: name }).promise();
    return u.QueueUrl;
  }

  static async deleteQueue(name) {
    const u = await this.getUrl(name);

    const queue = sqs();
    const params = {
      QueueUrl: u
    };

    return queue.deleteQueue(params).promise();
  }

  static async receiveMessage(name, numOfMessages = 1, timeout = 30) {
    const u = await this.getUrl(name);
    const queue = sqs();
    const params = {
      QueueUrl: u,
      AttributeNames: ['All'],
      VisibilityTimeout: timeout,
      MaxNumberOfMessages: numOfMessages
    };

    const messages = await queue.receiveMessage(params).promise();

    // convert body from string to js object
    if (messages.hasOwnProperty('Messages')) {
      messages.Messages.forEach((mes) => {
        mes.Body = JSON.parse(mes.Body);
      });

      return messages.Messages;
    }
    return [];
  }

  static async sendMessage(name, message) {
    let messageBody;
    if (typeof message === 'string') {
      messageBody = message;
    }
    else if (typeof message === 'object') {
      messageBody = JSON.stringify(message);
    }
    else {
      throw new Error('body type is not accepted');
    }

    const u = await this.getUrl(name);

    const params = {
      MessageBody: messageBody,
      QueueUrl: u
    };

    const queue = sqs();
    return queue.sendMessage(params).promise();
  }

  static async deleteMessage(name, receiptHandle) {
    const u = await this.getUrl(name);
    const queue = sqs();
    const params = {
      QueueUrl: u,
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


export class ECS {

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


export class CloudWatch {

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
   * @param {string} bucketName Name of the bucket to get the size
   * @returns {object} Retuns total storage for a given bucket
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
