'use strict';

const log = require('@cumulus/common/log');
const Task = require('@cumulus/common/task');
const docClient = require('@cumulus/common/aws').dynamodbDocClient();

/**
 * Task that deletes ingest tracking data when ingest completes.
 * Input payload: An object with the keys given in the output_keys configuration parameter and
 * possibly others.
 * Output payload: The value of the keys given in the output_keys configuration parameter.
 */
module.exports = class DeleteIngestTrackingData extends Task {

  /**
   * Main task entry point
   *
   * @returns {*} Any An object/array, etc., that consists of the value of given key in the
   * message payload
   */
  async run() {
    const message = this.message;
    const tableName = this.config.ingest_tracking_table;
    const granuleId = this.config.granule_meta.granuleId;
    const version = this.config.granule_meta.version;
    const payload = message.payload;

    // Delete the tracking data for the given granule from DynamoDB
    // This should be abstracted out to allow other key stores to be used. See
    // JIRA issue GITC-557
    const params = {
      TableName: tableName,
      Key: {
        'granule-id': granuleId,
        version: version
      }
    };

    log.debug(`Deleting ingest tracking for [${granuleId}]`);

    await docClient.delete(params).promise();

    return payload;
  }

  /**
   * Entry point for Lambda
   *
   * @param {Array} args - The arguments passed by AWS Lambda
   * @returns {*} The handler return value
   */
  static handler(...args) {
    return DeleteIngestTrackingData.handle(...args);
  }
};
