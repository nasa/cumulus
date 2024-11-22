'use strict';

const pvl = require('@cumulus/pvl');

/**
 * Generate Short PAN message
 *
 * @param {string} disposition disposition message
 * @returns {string} the PAN message
 */
function generateShortPAN(disposition) {
  return pvl.jsToPVL(
    new pvl.models.PVLRoot()
      .add('MESSAGE_TYPE', new pvl.models.PVLTextString('SHORTPAN'))
      .add('DISPOSITION', new pvl.models.PVLTextString(disposition))
      .add('TIME_STAMP', new pvl.models.PVLDateTime(new Date()))
  );
}

/**
 * Generate a PDRD message with a given err
 *
 * @param {object} err - the error object
 * @returns {string} the PDRD message
 */
function generatePDRD(err) {
  return pvl.jsToPVL(
    new pvl.models.PVLRoot()
      .add('MESSAGE_TYPE', new pvl.models.PVLTextString('SHORTPDRD'))
      .add('DISPOSITION', new pvl.models.PVLTextString(err.message))
  );
}

module.exports = {
  generateShortPAN,
  generatePDRD,
};
