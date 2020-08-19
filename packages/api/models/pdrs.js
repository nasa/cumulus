'use strict';

const get = require('lodash/get');

const log = require('@cumulus/common/log');
const { getCollectionIdFromMessage } = require('@cumulus/message/Collections');
const { getMessageExecutionArn } = require('@cumulus/message/Executions');
const pvl = require('@cumulus/pvl');
const StepFunctionUtils = require('../lib/StepFunctionUtils');
const Manager = require('./base');
const { CumulusModelError } = require('./errors');
const pdrSchema = require('./schemas').pdr;

class Pdr extends Manager {
  constructor() {
    super({
      tableName: process.env.PdrsTable,
      tableHash: { name: 'pdrName', type: 'S' },
      schema: pdrSchema,
    });
  }

  /**
   * Generate PAN message
   *
   * @returns {string} the PAN message
   */
  static generatePAN() {
    return pvl.jsToPVL(
      new pvl.models.PVLRoot()
        .add('MESSAGE_TYPE', new pvl.models.PVLTextString('SHORTPAN'))
        .add('DISPOSITION', new pvl.models.PVLTextString('SUCCESSFUL'))
        .add('TIME_STAMP', new pvl.models.PVLDateTime(new Date()))
    );
  }

  /**
   * Generate a PDRD message with a given err
   *
   * @param {Object} err - the error object
   * @returns {string} the PDRD message
   */
  static generatePDRD(err) {
    return pvl.jsToPVL(
      new pvl.models.PVLRoot()
        .add('MESSAGE_TYPE', new pvl.models.PVLTextString('SHORTPDRD'))
        .add('DISPOSITION', new pvl.models.PVLTextString(err.message))
    );
  }

  /**
   * Generate a PDR record.
   *
   * @param {Object} message - A workflow execution message
   * @returns {Object|undefined} - A PDR record, or null if `message.payload.pdr` is
   *   not set
   */
  generatePdrRecord(message) {
    const pdr = get(message, 'payload.pdr');

    if (!pdr) { // We got a message with no PDR (OK)
      log.info('No PDRs to process on the message');
      return undefined;
    }

    if (!pdr.name) { // We got a message with a PDR but no name to identify it (Not OK)
      throw new CumulusModelError(`Could not find name on PDR object ${JSON.stringify(pdr)}`);
    }

    const arn = getMessageExecutionArn(message);
    const execution = StepFunctionUtils.getExecutionUrl(arn);

    const collectionId = getCollectionIdFromMessage(message);
    if (!collectionId) {
      throw new CumulusModelError('meta.collection required to generate a PDR record');
    }

    const stats = {
      processing: get(message, 'payload.running', []).length,
      completed: get(message, 'payload.completed', []).length,
      failed: get(message, 'payload.failed', []).length,
    };

    stats.total = stats.processing + stats.completed + stats.failed;
    let progress = 0;
    if (stats.processing > 0 && stats.total > 0) {
      progress = ((stats.total - stats.processing) / stats.total) * 100;
    } else if (stats.processing === 0 && stats.total > 0) {
      progress = 100;
    }

    const record = {
      pdrName: pdr.name,
      collectionId,
      status: get(message, 'meta.status'),
      provider: get(message, 'meta.provider.id'),
      progress,
      execution,
      PANSent: get(pdr, 'PANSent', false),
      PANmessage: get(pdr, 'PANmessage', 'N/A'),
      stats,
      createdAt: get(message, 'cumulus_meta.workflow_start_time'),
      timestamp: Date.now(),
    };

    record.duration = (record.timestamp - record.createdAt) / 1000;
    this.constructor.recordIsValid(record, this.schema);
    return record;
  }

  /**
   * Try to update a PDR record from a cloudwatch event.
   * If the record already exists, only update if the execution is different (re-run case).
   *
   * @param {Object} cumulusMessage - cumulus message object
   */
  async storePdrFromCumulusMessage(cumulusMessage) {
    const pdrRecord = this.generatePdrRecord(cumulusMessage);
    if (!pdrRecord) return undefined;
    const updateParams = await this.generatePdrUpdateParamsFromRecord(pdrRecord);
    if (pdrRecord.status === 'running') {
      updateParams.ConditionExpression = 'execution <> :execution OR progress < :progress';
      try {
        return await this.dynamodbDocClient.update(updateParams).promise();
      } catch (error) {
        if (error.name && error.name.includes('ConditionalCheckFailedException')) {
          const executionArn = getMessageExecutionArn(cumulusMessage);
          log.info(`Did not process delayed 'running' event for PDR: ${pdrRecord.pdrName} (execution: ${executionArn})`);
          return undefined;
        }
        throw error;
      }
    }
    return this.dynamodbDocClient.update(updateParams).promise();
  }

  /**
   * Generate DynamoDB update parameters.
   *
   * @param {Object} pdrRecord - the PDR record
   * @returns {Object} DynamoDB update parameters
   */
  async generatePdrUpdateParamsFromRecord(pdrRecord) {
    const mutableFieldNames = Object.keys(pdrRecord);
    const updateParams = this._buildDocClientUpdateParams({
      item: pdrRecord,
      itemKey: { pdrName: pdrRecord.pdrName },
      mutableFieldNames,
    });
    return updateParams;
  }

  /**
   * Only used for testing
   */
  async deletePdrs() {
    const pdrs = await this.scan();
    return Promise.all(pdrs.Items.map((pdr) => super.delete({ pdrName: pdr.pdrName })));
  }
}

module.exports = Pdr;
