'use strict';

const get = require('lodash.get');
const pLimit = require('p-limit');

const { getExecutionArn } = require('@cumulus/common/aws');
const {
  getCollectionIdFromMessage,
  getMessageExecutionName,
  getMessageStateMachineArn
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
   * Generate an execution record from a workflow execution message.
   *
   * @param {Object} message - A workflow execution message
   * @returns {Object} An execution record
   */
  static async generateRecord(message) {
    const executionName = getMessageExecutionName(message);
    const stateMachineArn = getMessageStateMachineArn(message);
    const arn = getExecutionArn(
      stateMachineArn,
      executionName
    );

    const execution = aws.getExecutionUrl(arn);
    const collectionId = getCollectionIdFromMessage(message);

    const status = get(message, 'meta.status', 'unknown');

    const record = {
      name: executionName,
      arn,
      parentArn: get(message, 'cumulus_meta.parentExecutionArn'),
      execution,
      tasks: get(message, 'meta.workflow_tasks'),
      error: parseException(message.exception),
      type: get(message, 'meta.workflow_name'),
      collectionId,
      status,
      createdAt: get(message, 'cumulus_meta.workflow_start_time'),
      timestamp: Date.now()
    };

    const currentPayload = get(message, 'payload');
    if (['failed', 'completed'].includes(status)) {
      const existingRecord = await new Execution().get({ arn });
      record.finalPayload = currentPayload;
      record.originalPayload = existingRecord.originalPayload;
    } else {
      record.originalPayload = currentPayload;
    }

    record.duration = (record.timestamp - record.createdAt) / 1000;
    return record;
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
   * Update an existing execution record, replacing all fields except originalPayload
   * adding the existing payload to the finalPayload database field
   *
   * @param {Object} message - A workflow execution message
   * @returns {Promise<Object>} An execution record
   */
  async updateExecutionFromSns(message) {
    const record = await Execution.generateRecord(message);
    return this.create(record);
  }

  /**
   * Create a new execution record from incoming SNS messages
   *
   * @param {Object} message - A workflow execution message
   * @returns {Promise<Object>} An execution record
   */
  async createExecutionFromSns(message) {
    const record = await Execution.generateRecord(message);
    return this.create(record);
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
