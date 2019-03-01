'use strict';

const aws = require('@cumulus/ingest/aws');
const get = require('lodash.get');

const pLimit = require('p-limit');

const CumulusMessage = require('../lib/CumulusMessage');
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

  generateDocFromPayload(payload) {
    const name = get(payload, 'cumulus_meta.execution_name');
    const arn = aws.getExecutionArn(
      get(payload, 'cumulus_meta.state_machine'),
      name
    );
    if (!arn) {
      throw new Error('State Machine Arn is missing. Must be included in the cumulus_meta');
    }

    const execution = aws.getExecutionUrl(arn);
    const collectionId = CumulusMessage.getCollectionId(payload);

    const doc = {
      name,
      arn,
      parentArn: get(payload, 'cumulus_meta.parentExecutionArn'),
      execution,
      tasks: get(payload, 'meta.workflow_tasks'),
      error: parseException(payload.exception),
      type: get(payload, 'meta.workflow_name'),
      collectionId: collectionId,
      status: get(payload, 'meta.status', 'unknown'),
      createdAt: get(payload, 'cumulus_meta.workflow_start_time'),
      timestamp: Date.now()
    };
    return doc;
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
   * @param {Object} payload sns message containing the output of a Cumulus Step Function
   * @returns {Promise<Object>} An execution record
   */
  async updateExecutionFromSns(payload) {
    return this.create(
      await this.buildUpdatedExecutionRecordFromCumulusMessage(payload)
    );
  }

  /**
   * Create a new execution record from incoming sns messages
   *
   * @param {Object} payload - SNS message containing the output of a Cumulus Step Function
  * @returns {Promise<Object>} An execution record
   */
  async createExecutionFromSns(payload) {
    return this.create(
      this.buildNewExecutionRecordFromCumulusMessage(payload)
    );
  }

  buildNewExecutionRecordFromCumulusMessage(cumulusMessage) {
    const executionRecord = this.generateDocFromPayload(cumulusMessage);

    executionRecord.originalPayload = cumulusMessage.payload;
    executionRecord.duration = (executionRecord.timestamp - executionRecord.createdAt) / 1000;

    const now = Date.now();
    return {
      createdAt: now,
      ...executionRecord,
      updatedAt: now
    };
  }

  async buildUpdatedExecutionRecordFromCumulusMessage(cumulusMessage) {
    const newRecord = this.generateDocFromPayload(cumulusMessage);

    const existingRecord = await this.get({ arn: newRecord.arn });

    newRecord.finalPayload = get(cumulusMessage, 'payload');
    newRecord.originalPayload = existingRecord.originalPayload;
    newRecord.duration = (newRecord.timestamp - newRecord.createdAt) / 1000;

    const now = Date.now();
    return {
      createdAt: now,
      ...newRecord,
      updatedAt: now
    };
  }
}
module.exports = Execution;
