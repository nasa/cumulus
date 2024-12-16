'use strict';

const pvl = require('@cumulus/pvl');
const { getExecution } = require('@cumulus/api-client/executions');

/**
 * Generate Short PAN message
 *
 * @param {string} disposition - disposition message
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

async function getGranuleFromExecution(executionArn) {
  const excObj = await getExecution({
    prefix: process.env.stackName,
    arn: executionArn,
  });
  return excObj.originalPayload.granules[0];
}

/**
 * Generate Long PAN message
 *
 * @param {Object|string[]} executions - List of workflow executions
 * @returns {string} the PAN message
 */
async function generateLongPAN(executions) {
  const timeStamp = new Date();

  const longPan = new pvl.models.PVLRoot()
    .add('MESSAGE_TYPE', new pvl.models.PVLTextString('LONGPAN'))
    .add('NO_OF_FILES', new pvl.models.PVLNumeric(executions.length));
  /* eslint-disable no-await-in-loop */
  for (const exc of executions) {
    const granule = await getGranuleFromExecution(exc.arn || exc);
    longPan.add('FILE_DIRECTORY', new pvl.models.PVLTextString(granule.files[0].path));
    longPan.add('FILE_NAME', new pvl.models.PVLTextString(granule.granuleId));
    longPan.add('DISPOSITION', new pvl.models.PVLTextString(exc.reason || 'SUCCESSFUL'));
    longPan.add('TIME_STAMP', new pvl.models.PVLDateTime(timeStamp));
  }
  /* eslint-enable no-await-in-loop */
  return pvl.jsToPVL(longPan);
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
  generateLongPAN,
  generatePDRD,
  getGranuleFromExecution,
};
