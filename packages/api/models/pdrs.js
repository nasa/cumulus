'use strict';

const log = require('@cumulus/common/log');
const { getCollectionIdFromMessage } = require('@cumulus/message/Collections');
const {
  getMessageExecutionArn,
  getExecutionUrlFromArn,
} = require('@cumulus/message/Executions');
const {
  getMessagePdr,
  getMessagePdrPANSent,
  getMessagePdrPANMessage,
  getMessagePdrStats,
  getPdrPercentCompletion,
} = require('@cumulus/message/PDRs');
const {
  getMessageProviderId,
} = require('@cumulus/message/Providers');
const {
  getMetaStatus,
  getMessageWorkflowStartTime,
  getWorkflowDuration,
} = require('@cumulus/message/workflows');
const pvl = require('@cumulus/pvl');
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
    const pdr = getMessagePdr(message);

    if (!pdr) { // We got a message with no PDR (OK)
      log.info('No PDRs to process on the message');
      return undefined;
    }

    if (!pdr.name) { // We got a message with a PDR but no name to identify it (Not OK)
      throw new CumulusModelError(`Could not find name on PDR object ${JSON.stringify(pdr)}`);
    }

    const arn = getMessageExecutionArn(message);
    const execution = getExecutionUrlFromArn(arn);

    const collectionId = getCollectionIdFromMessage(message);
    if (!collectionId) {
      throw new CumulusModelError('meta.collection required to generate a PDR record');
    }

    const stats = getMessagePdrStats(message);
    const progress = getPdrPercentCompletion(stats);
    const now = Date.now();
    const workflowStartTime = getMessageWorkflowStartTime(message);

    const record = {
      pdrName: pdr.name,
      collectionId,
      status: getMetaStatus(message),
      provider: getMessageProviderId(message),
      progress,
      execution,
      PANSent: getMessagePdrPANSent(message),
      PANmessage: getMessagePdrPANMessage(message),
      stats,
      createdAt: getMessageWorkflowStartTime(message),
      timestamp: now,
      updatedAt: now,
      duration: getWorkflowDuration(workflowStartTime, now),
    };

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

    // createdAt comes from cumulus_meta.workflow_start_time
    // records should *not* be updating from createdAt times that are *older* start
    // times than the existing record, whatever the status
    updateParams.ConditionExpression = '(attribute_not_exists(createdAt) or :createdAt >= #createdAt)';
    if (pdrRecord.status === 'running') {
      updateParams.ConditionExpression += ' and (execution <> :execution OR progress < :progress)';
    }
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
