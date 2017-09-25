'use strict';

const log = require('@cumulus/common/log');
const Task = require('@cumulus/common/task');
const aws = require('@cumulus/common/aws');

/**
 * Task that deletes a PDR from S3
 * Input payload: The PDR file name (not the S3 key)
 * Output payload: The original input payload
 */
module.exports = class DeletePdrS3 extends Task {
  /**
   * Main task entry point
   * @return An object referencing the oldest PDR on the server
   */
  async run() {
    // Message payload contains the name of the PDR to be deleted
    const payload = await this.message.payload;
    const pdrFileName = payload.pdr_file_name;
    const bucket = this.config.bucket;
    const keyPrefix = `${this.config.key_prefix}/pdr`;
    const s3PdrKey = `${keyPrefix}/${pdrFileName}`;
    const deleteRequest = [
      {
        Bucket: bucket,
        Key: s3PdrKey
      }
    ];

    await aws.deleteS3Files(deleteRequest);

    log.info(`PDR ${pdrFileName} DELETED FROM S3`);

    return payload;
  }

  /**
   * Entry point for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return DeletePdrS3.handle(...args);
  }
};
