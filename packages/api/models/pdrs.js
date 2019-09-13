'use strict';

const get = require('lodash.get');

const log = require('@cumulus/common/log');
const { getCollectionIdFromMessage, getMessageExecutionArn } = require('@cumulus/common/message');
const aws = require('@cumulus/ingest/aws');
const pvl = require('@cumulus/pvl');

const Manager = require('./base');
const pdrSchema = require('./schemas').pdr;

class Pdr extends Manager {
  constructor() {
    super({
      tableName: process.env.PdrsTable,
      tableHash: { name: 'pdrName', type: 'S' },
      schema: pdrSchema
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
   * @returns {Object} - A PDR record
   */
  static generatePdrRecord(message) {
    const pdr = get(message, 'payload.pdr', get(message, 'meta.pdr'));
    let record;

    if (!pdr) {
      log.info('No PDRs to process on the message');
      return record;
    }

    if (!pdr.name) {
      log.info('Could not find name on PDR object', pdr);
      return record;
    }

    const arn = getMessageExecutionArn(message);
    const execution = aws.getExecutionUrl(arn);

    const collectionId = getCollectionIdFromMessage(message);

    const stats = {
      processing: get(message, 'payload.running', []).length,
      completed: get(message, 'payload.completed', []).length,
      failed: get(message, 'payload.failed', []).length
    };

    stats.total = stats.processing + stats.completed + stats.failed;
    let progress = 0;
    if (stats.processing > 0 && stats.total > 0) {
      progress = ((stats.total - stats.processing) / stats.total) * 100;
    } else if (stats.processing === 0 && stats.total > 0) {
      progress = 100;
    }

    record = {
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
      timestamp: Date.now()
    };

    record.duration = (record.timestamp - record.createdAt) / 1000;
    return record;
  }

  /**
   * Create a new PDR record from incoming SNS messages
   *
   * @param {Object} payload - SNS message containing the output of a Cumulus Step Function
   * @returns {Promise<Object>} a PDR record
   */
  createPdrFromSns(payload) {
    const pdrObj = get(payload, 'payload.pdr', get(payload, 'meta.pdr'));
    const pdrName = get(pdrObj, 'name');

    if (!pdrName) return Promise.resolve();

    const pdrRecord = Pdr.generatePdrRecord(payload);

    return this.create(pdrRecord);
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
