'use strict';

const privates = new WeakMap();

// MessageTemplateStore instance private method
function messageTemplateKey(workflowName) {
  const { stackName } = privates.get(this);

  return `${stackName}/workflows/${workflowName}.json`;
}

class MessageTemplateStore {
  /**
   *
   * @param {Object} params
   * @param {string} params.bucket - the name of the bucket containing the
   *   message templates
   * @param {Object} params.s3 - an AWS S3 Service Object
   * @param {string} params.stackName - the name of the Cumulus stack
   */
  constructor(params = {}) {
    if (!params.bucket) throw new TypeError('bucket is required');
    if (!params.s3) throw new TypeError('s3 is required');
    if (!params.stackName) throw new TypeError('stackName is required');

    privates.set(
      this,
      {
        bucket: params.bucket,
        s3: params.s3,
        stackName: params.stackName
      }
    );
  }

  /**
   * The s3:// URL of the workflow's message template
   *
   * @param {string} workflowName
   * @returns {Promise<string>} the s3:// URL of the message template
   */
  templateS3Url(workflowName) {
    const { bucket } = privates.get(this);
    return `s3://${bucket}/${messageTemplateKey.call(this, workflowName)}`;
  }

  /**
   * Store the workflow's message template
   *
   * @param {string} workflowName
   * @param {string} messageTemplate
   */
  async put(workflowName, messageTemplate) {
    const { bucket, s3 } = privates.get(this);

    await s3.putObject({
      Bucket: bucket,
      Key: messageTemplateKey.call(this, workflowName),
      Body: messageTemplate
    }).promise();
  }

  /**
   * Get a workflow template
   *
   * @param {string} workflowName
   * @returns {Promise<string>}
   */
  async get(workflowName) {
    const { bucket, s3 } = privates.get(this);

    return s3.getObject({
      Bucket: bucket,
      Key: messageTemplateKey.call(this, workflowName)
    }).promise()
      .then((response) => response.Body.toString());
  }

  /**
   * Test if a workflow exists
   *
   * @param {string} workflowName
   * @returns {Promise<boolean>}
   */
  async exists(workflowName) {
    const { bucket, s3 } = privates.get(this);

    try {
      await s3.headObject({
        Bucket: bucket,
        Key: messageTemplateKey.call(this, workflowName)
      }).promise();

      return true;
    }
    catch (err) {
      if (err.code === 'NotFound') return false;

      throw err;
    }
  }
}
module.exports = MessageTemplateStore;
