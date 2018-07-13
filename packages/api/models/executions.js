'use strict';

const get = require('lodash.get');
const aws = require('@cumulus/ingest/aws');
const Manager = require('./base');
const { parseException } = require('../lib/utils');
const executionSchema = require('./schemas').execution;


class Execution extends Manager {
  constructor() {
    super(process.env.ExecutionsTable, executionSchema);
  }

  /**
   * Create the dynamoDB for this class
   *
   * @returns {Promise} aws dynamodb createTable response
   */
  async createTable() {
    const hash = { name: 'arn', type: 'S' };
    return Manager.createTable(this.tableName, hash);
  }

  /**
   * Create a new execution record from incoming sns messages
   *
   * @param {Object} payload - sns message containing the output of a Cumulus Step Function
   * @returns {Promise<Object>} an execution record
   */
  createExecutionFromSns(payload) {
    const name = get(payload, 'cumulus_meta.execution_name');
    const arn = aws.getExecutionArn(
      get(payload, 'cumulus_meta.state_machine'),
      name
    );
    if (!arn) {
      const error = new Error('State Machine Arn is missing. Must be included in the cumulus_meta');
      return Promise.reject(error);
    }

    const execution = aws.getExecutionUrl(arn);

    const doc = {
      name,
      arn,
      execution,
      error: parseException(payload.exception),
      type: get(payload, 'meta.workflow_name'),
      collectionId: get(payload, 'meta.collection.name'),
      status: get(payload, 'meta.status', 'unknown'),
      createdAt: get(payload, 'cumulus_meta.workflow_start_time'),
      timestamp: Date.now()
    };

    doc.duration = (doc.timestamp - doc.createdAt) / 1000;
    return this.create(doc);
  }
}

module.exports = Execution;
