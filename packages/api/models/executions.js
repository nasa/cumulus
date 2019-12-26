'use strict';

const get = require('lodash.get');
const pLimit = require('p-limit');

const {
  getCollectionIdFromMessage,
  getMessageExecutionArn,
  getMessageExecutionName
} = require('@cumulus/common/message');
const { isNil, removeNilProperties } = require('@cumulus/common/util');
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
    if (isNil(arn)) throw new Error('Unable to determine execution ARN from Cumulus message');

    const status = get(cumulusMessage, 'meta.status');
    if (!status) throw new Error('Unable to determine status from Cumulus message');

    const now = Date.now();
    const workflowStartTime = get(cumulusMessage, 'cumulus_meta.workflow_start_time');
    const workflowStopTime = get(cumulusMessage, 'cumulus_meta.workflow_stop_time');

    const record = {
      name: getMessageExecutionName(cumulusMessage),
      arn,
      asyncOperationId: get(cumulusMessage, 'cumulus_meta.asyncOperationId'),
      parentArn: get(cumulusMessage, 'cumulus_meta.parentExecutionArn'),
      execution: aws.getExecutionUrl(arn),
      tasks: get(cumulusMessage, 'meta.workflow_tasks'),
      error: parseException(cumulusMessage.exception),
      type: get(cumulusMessage, 'meta.workflow_name'),
      collectionId: getCollectionIdFromMessage(cumulusMessage),
      status,
      createdAt: workflowStartTime,
      timestamp: now,
      updatedAt: now,
      originalPayload: status === 'running' ? cumulusMessage.payload : undefined,
      finalPayload: status === 'running' ? undefined : cumulusMessage.payload,
      duration: isNil(workflowStopTime) ? 0 : (workflowStopTime - workflowStartTime) / 1000
    };

    return removeNilProperties(record);
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

  buildDocClientUpdateParams(item) {
    const ExpressionAttributeNames = {};
    const ExpressionAttributeValues = {};
    const setUpdateExpressions = [];

    Object.entries(item).forEach(([key, value]) => {
      if (key === 'arn') return;
      if (value === undefined) return;

      ExpressionAttributeNames[`#${key}`] = key;
      ExpressionAttributeValues[`:${key}`] = value;

      if (item.status === 'running') {
        if (['createdAt', 'updatedAt', 'timestamp', 'originalPayload'].includes(key)) {
          setUpdateExpressions.push(`#${key} = :${key}`);
        } else {
          setUpdateExpressions.push(`#${key} = if_not_exists(#${key}, :${key})`);
        }
      } else {
        setUpdateExpressions.push(`#${key} = :${key}`);
      }
    });

    if (setUpdateExpressions.length === 0) return null;

    return {
      TableName: this.tableName,
      Key: { arn: item.arn },
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      UpdateExpression: `SET ${setUpdateExpressions.join(', ')}`
    };
  }

  async storeExecutionFromCumulusMessage(cumulusMessage) {
    const executionItem = Execution.generateRecord(cumulusMessage);
    const updateParams = this.buildDocClientUpdateParams(executionItem);

    await this.dynamodbDocClient.update(updateParams).promise();
  }
}

module.exports = Execution;
