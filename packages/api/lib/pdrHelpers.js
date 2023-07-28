'use strict';

const pvl = require('@cumulus/pvl');

/**
 * Generate PAN message
 *
 * @returns {string} the PAN message
 */
function generatePAN() {
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
  generatePAN,
  generatePDRD,
};
