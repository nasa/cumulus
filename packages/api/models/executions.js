'use strict';

const aws = require('@cumulus/ingest/aws');
const get = require('lodash.get');

const pLimit = require('p-limit');

const { constructCollectionId } = require('@cumulus/common');
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
    const collectionId = constructCollectionId(
      get(payload, 'meta.collection.name'), get(payload, 'meta.collection.version')
    );

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
   * Scan the Executions table ahd remove originalPayload/finalPayload records from the table
   *
   * @param {integer} maxAgeDays - Maximum number of days a record may have payload entries
   * @returns {Promise<Array>} - Execution table objects that were updated
   */
  async removeOldPayloadRecords(maxAgeDays) {
    if (!process.env.executionPayloadTimeout === 'disabled') {
      return [];
    }
    // DB uses milliseconds.  Convert to days for the expiration comparison value
    const expiryDate = Date.now() - (1000 * 3600 * 24 * maxAgeDays);
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

    const updatePromises = oldExecutionRows.Items.map((row) => limit(() => this.update({ arn: row.arn }, {}, ['originalPayload', 'finalPayload'])));
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
    const doc = this.generateDocFromPayload(payload);
    const existingRecord = await this.get({ arn: doc.arn });
    doc.finalPayload = get(payload, 'payload');
    doc.originalPayload = existingRecord.originalPayload;
    doc.duration = (doc.timestamp - doc.createdAt) / 1000;
    return this.create(doc);
  }

  /**
   * Create a new execution record from incoming sns messages
   *
   * @param {Object} payload - SNS message containing the output of a Cumulus Step Function
  * @returns {Promise<Object>} An execution record
   */
  async createExecutionFromSns(payload) {
    const doc = this.generateDocFromPayload(payload);
    doc.originalPayload = get(payload, 'payload');
    doc.duration = (doc.timestamp - doc.createdAt) / 1000;
    return this.create(doc);
  }
}

module.exports = Execution;
