'use strict';

const pvl = require('@cumulus/pvl');
const get = require('lodash.get');
const aws = require('@cumulus/ingest/aws');
const { isNil } = require('@cumulus/common/util');

const CumulusMessage = require('../lib/CumulusMessage');
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

  buildPdrRecordFromCumulusMessage(cumulusMessage) {
    const pdrObj = get(cumulusMessage, 'payload.pdr', get(cumulusMessage, 'meta.pdr'));
    const pdrName = pdrObj.name;

    if (!pdrName) return null;

    const execution = aws.getExecutionUrl(
      CumulusMessage.getExecutionArn(cumulusMessage)
    );

    const stats = {
      processing: get(cumulusMessage, 'payload.running', []).length,
      completed: get(cumulusMessage, 'payload.completed', []).length,
      failed: get(cumulusMessage, 'payload.failed', []).length
    };

    stats.total = stats.processing + stats.completed + stats.failed;
    let progress = 0;
    if (stats.processing > 0 && stats.total > 0) {
      progress = ((stats.total - stats.processing) / stats.total) * 100;
    }
    else if (stats.processing === 0 && stats.total > 0) {
      progress = 100;
    }

    const now = Date.now();

    const pdrRecord = {
      pdrName,
      collectionId: CumulusMessage.getCollectionId(cumulusMessage),
      status: get(cumulusMessage, 'meta.status'),
      provider: get(cumulusMessage, 'meta.provider.id'),
      progress,
      execution,
      PANSent: get(pdrObj, 'PANSent', false),
      PANmessage: get(pdrObj, 'PANmessage', 'N/A'),
      stats,
      createdAt: get(cumulusMessage, 'cumulus_meta.workflow_start_time'),
      timestamp: now
    };

    pdrRecord.duration = (pdrRecord.timestamp - pdrRecord.createdAt) / 1000;

    return {
      createdAt: now,
      ...pdrRecord,
      updatedAt: now
    };
  }

  /**
   * Create a new pdr record from incoming sns messages
   *
   * @param {Object} cumulusMessage - sns message containing the output of a Cumulus Step Function
   * @returns {Promise<Object>|null} a pdr record
   */
  createPdrFromSns(cumulusMessage) {
    const record = this.buildPdrRecordFromCumulusMessage(cumulusMessage);

    if (isNil(record)) return null;

    return this.create(record);
  }
}
module.exports = Pdr;
