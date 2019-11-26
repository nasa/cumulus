'use strict';

const get = require('lodash.get');
const pLimit = require('p-limit');

const {
  getCollectionIdFromMessage,
  getMessageExecutionArn,
  getMessageExecutionName
} = require('@cumulus/common/message');
const aws = require('@cumulus/ingest/aws');

const executionSchema = require('./schemas').execution;
const Manager = require('./base');
const { parseException } = require('../lib/utils');

class Execution extends Manager {
  constructor() {
    super({
      tableName: process.env.ExecutionsTable,
      tableHash: { name: 'arn', type: 'S' },
      schema: executionSchema
    });
  }

  /**
   * Generate an execution record from a Cumulus message.
   *
   * @param {Object} cumulusMessage - A Cumulus message
   * @returns {Object} An execution record
   */
  static generateRecord(cumulusMessage) {
    const arn = getMessageExecutionArn(cumulusMessage);
    const now = Date.now();

    return {
      name: getMessageExecutionName(cumulusMessage),
      arn,
      asyncOperationId: get(cumulusMessage, 'cumulus_meta.asyncOperationId'),
      parentArn: get(cumulusMessage, 'cumulus_meta.parentExecutionArn'),
      execution: aws.getExecutionUrl(arn),
      tasks: get(cumulusMessage, 'meta.workflow_tasks'),
      error: parseException(cumulusMessage.exception),
      type: get(cumulusMessage, 'meta.workflow_name'),
      collectionId: getCollectionIdFromMessage(cumulusMessage),
      status: get(cumulusMessage, 'meta.status'),
      createdAt: get(cumulusMessage, 'cumulus_meta.workflow_start_time'),
      timestamp: now,
      updatedAt: now
    };
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
      values: executionValues
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
    return Promise.all(updatePromises);
  }

  /**
   * Only used for testing
   */
  async deleteExecutions() {
    const executions = await this.scan();
    return Promise.all(executions.Items.map((execution) => super.delete({ arn: execution.arn })));
  }
}

module.exports = Execution;
