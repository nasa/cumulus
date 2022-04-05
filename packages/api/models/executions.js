'use strict';

const pLimit = require('p-limit');

const Logger = require('@cumulus/logger');

const {
  generateExecutionApiRecordFromMessage,
} = require('@cumulus/message/Executions');

const executionSchema = require('./schemas').execution;
const Manager = require('./base');

const logger = new Logger({ sender: '@cumulus/api/models/executions' });

class Execution extends Manager {
  constructor() {
    super({
      tableName: process.env.ExecutionsTable,
      tableHash: { name: 'arn', type: 'S' },
      schema: executionSchema,
    });
  }

  /**
   * Scan the Executions table and remove originalPayload/finalPayload records from the table
   *
   * @param {integer} completeMaxDays - Maximum number of days a completed
   *   record may have payload entries
   * @param {integer} nonCompleteMaxDays - Maximum number of days a non-completed
   *   record may have payload entries
   * @param {boolean} disableComplete - Disable removal of completed execution
   *   payloads
   * @param {boolean} disableNonComplete - Disable removal of execution payloads for
   *   statuses other than 'completed'
   * @returns {Promise<Array>} - Execution table objects that were updated
   */
  async removeOldPayloadRecords(completeMaxDays, nonCompleteMaxDays,
    disableComplete, disableNonComplete) {
    const msPerDay = 1000 * 3600 * 24;
    const completeMaxMs = Date.now() - (msPerDay * completeMaxDays);
    const nonCompleteMaxMs = Date.now() - (msPerDay * nonCompleteMaxDays);
    const expiryDate = completeMaxDays < nonCompleteMaxDays ? completeMaxMs : nonCompleteMaxMs;
    const executionNames = { '#updatedAt': 'updatedAt' };
    const executionValues = { ':expiryDate': expiryDate };
    const filter = '#updatedAt <= :expiryDate and (attribute_exists(originalPayload) or attribute_exists(finalPayload))';

    const oldExecutionRows = await this.scan({
      names: executionNames,
      filter: filter,
      values: executionValues,
    });

    const concurrencyLimit = process.env.CONCURRENCY || 10;
    const limit = pLimit(concurrencyLimit);

    const updatePromises = oldExecutionRows.Items.map((row) => limit(() => {
      if (!disableComplete && row.status === 'completed' && row.updatedAt <= completeMaxMs) {
        return this.update({ arn: row.arn }, {}, ['originalPayload', 'finalPayload']);
      }
      if (!disableNonComplete && !(row.status === 'completed') && row.updatedAt <= nonCompleteMaxMs) {
        return this.update({ arn: row.arn }, {}, ['originalPayload', 'finalPayload']);
      }
      return Promise.resolve();
    }));
    return await Promise.all(updatePromises);
  }

  /**
   * Only used for testing
   */
  async deleteExecutions() {
    const executions = await this.scan();
    return await Promise.all(executions.Items.map(
      (execution) => super.delete({ arn: execution.arn })
    ));
  }

  /**
   * Get the set of fields which are mutable based on the execution status.
   *
   * @param {Object} record - An execution record
   * @returns {Array} - The array of mutable field names
   */
  _getMutableFieldNames(record) {
    if (record.status === 'running') {
      return ['updatedAt', 'timestamp', 'originalPayload'];
    }
    return Object.keys(record);
  }

  /**
   * Store an execution record
   *
   * @param {Object} record - an execution record
   * @returns {Promise}
   */
  async storeExecutionRecord(record) {
    logger.info(`About to write execution ${record.arn} to DynamoDB`);

    // TODO: Refactor this all to use model.update() to avoid having to manually call
    // schema validation and the actual client.update() method.
    await this.constructor.recordIsValid(record, this.schema, this.removeAdditional);

    const mutableFieldNames = this._getMutableFieldNames(record);
    const updateParams = this._buildDocClientUpdateParams({
      item: record,
      itemKey: { arn: record.arn },
      mutableFieldNames,
    });

    await this.dynamodbDocClient.update(updateParams);
    logger.info(`Successfully wrote execution ${record.arn} to DynamoDB`);
  }

  /**
   * Generate and store an execution record from a Cumulus message.
   *
   * @param {Object} cumulusMessage - Cumulus workflow message
   * @param {number} [updatedAt] - Optional updated timestamp for record
   * @returns {Promise}
   */
  async storeExecutionFromCumulusMessage(cumulusMessage, updatedAt) {
    const executionItem = generateExecutionApiRecordFromMessage(cumulusMessage, updatedAt);
    await this.storeExecutionRecord(executionItem);
  }
}

module.exports = Execution;
