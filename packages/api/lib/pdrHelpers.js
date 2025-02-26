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

/**
 * Get list of input granules from execution
 *
 * @param {string} executionArn - execution arn
 * @returns {object[]} list of granules
 */
async function getGranulesFromExecution(executionArn) {
  const excObj = await getExecution({
    prefix: process.env.stackName,
    arn: executionArn,
  });
  return excObj.originalPayload.granules;
}

const granulesFileCount = (granules) => granules.reduce((sum, { files }) => sum + files.length, 0);

/**
 * Generate Long PAN message
 *
 * @param {object[]} executions - List of workflow executions
 * @returns {string} the PAN message
 */
async function generateLongPAN(executions) {
  const timeStamp = new Date();

  const executionsWithGranules = [];
  /* eslint-disable no-await-in-loop */
  for (const exc of executions) {
    const arn = exc.arn || exc;
    const granules = await getGranulesFromExecution(arn);
    executionsWithGranules.push({ arn, granules, reason: exc.reason });
  }
  /* eslint-enable no-await-in-loop */

  const fileCount = executionsWithGranules
    .reduce((sum, { granules }) => sum + granulesFileCount(granules), 0);

  const longPan = new pvl.models.PVLRoot()
    .add('MESSAGE_TYPE', new pvl.models.PVLTextString('LONGPAN'));
  longPan.add('NO_OF_FILES', new pvl.models.PVLNumeric(fileCount));

  for (const exc of executionsWithGranules) {
    for (const granule of exc.granules) {
      for (const file of granule.files) {
        longPan.add('FILE_DIRECTORY', new pvl.models.PVLTextString(file.path));
        longPan.add('FILE_NAME', new pvl.models.PVLTextString(file.name));
        longPan.add('DISPOSITION', new pvl.models.PVLTextString(exc.reason || 'SUCCESSFUL'));
        longPan.add('TIME_STAMP', new pvl.models.PVLDateTime(timeStamp));
      }
    }
  }

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
  getGranulesFromExecution,
};
