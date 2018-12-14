'use strict';

const aws = require('@cumulus/ingest/aws');
const get = require('lodash.get');

const { constructCollectionId } = require('@cumulus/common');
const cloneDeep = require('lodash.clonedeep');
const { parseException } = require('../lib/utils');
const { RecordDoesNotExist } = require('../lib/errors');
const { ExecutionSchema } = require('./schemas').execution;
const Model = require('./model');


class Execution extends Model {
  constructor() {
    super();
    this.tableName = Execution.tableName;
    this.removeAdditional = 'all';
    this.schema = ExecutionSchema;
    this.jsonFields = ['error', 'tasks', 'originalPayload', 'finalPayload']
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


    // TODO: Right now this is the text name of the collection, *not* a collection
    // (model?) object.  It's inferred by the payload.  We need to resolve this
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
   *  Search the Executions table and remove originalPayload/finalPayload records from the table
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
    const completeMaxMs = new Date(new Date() - new Date((msPerDay * completeMaxDays)));
    const nonCompleteMaxMs = new Date(new Date() - new Date((msPerDay * nonCompleteMaxDays)));

    if (!disableComplete) {
      await this.table()
        .where('updated_at', '<=', completeMaxMs)
        .where('status', 'completed')
        .update({
          original_payload: null,
          final_payload: null
        });
    }
    if (!disableNonComplete) {
      await this.table()
        .where('updated_at', '<=', nonCompleteMaxMs)
        .whereNot('status', 'completed')
        .update({
          original_payload: null,
          final_payload: null
        });
    }
  }

  /**
   *
   * @param {Obejct} item execution object to delete.  Requires arn key/value
   */
  async delete(item) {
    const arn = item.arn;
    await this.table()
      .where({ arn })
      .del();
  }

  /**
   * Updates an execution
   *
   * @param { Object } keyObject { arn: key } object
   * @param { Object } item an execution object with key/value pairs to update
   * @param { Array<string> } [keysToDelete=[]] array of keys to set to null.
   * @returns { string } arn updated execution
   **/
  async update(keyObject, item, keysToDelete = []) {
    const arn = keyObject.arn;
    const updatedItem = cloneDeep(item);

    keysToDelete.forEach((key) => {
      updatedItem[key] = null;
    });

    await this.table()
      .where({ arn })
      .update(this.translateItemToSnakeCase(updatedItem));
    return this.get(keyObject);
  }


  /**
   * Insert new row into the database
   *
   * @param {Object} item execution 'object' representing a row to create
   * @returns {Object} the the full item added with modifications made by the model
   */
  async insert(item) {
    await this.table()
      .insert(this.translateItemToSnakeCase(item));
    return this.get({ arn: item.arn });
  }

  /**
   * Returns row matching arn
   *
   * @param {string} item Execution item
   * @returns {Object} execution object
   */
  async get(item) {
    const arn = item.arn;
    const result = await this.table()
      .first()
      .where({ arn });
    if (!result) {
      throw new RecordDoesNotExist(`No record found for ${JSON.stringify(item)}`);
    }
    return this.translateItemToCamelCase(result);
  }

  /**
   * Check if a given execution exists
   *
   * @param {string} arn - execution arn
   * @returns {boolean}
   */
  async exists(arn) {
    return super.exists({ arn });
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
    return this.update({arn: doc.arn}, doc);
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

Execution.tableName = 'executions';
module.exports = Execution;
