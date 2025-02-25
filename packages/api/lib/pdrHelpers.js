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

async function getExecutionObjs(executions) {
  const excObjs = await Promise.all(
    executions.map(async (exc) => {
      const excObj = await getExecution({ prefix: process.env.stackName, arn: exc.arn || exc });
      return {
        ...excObj,
        reason: exc.reason,
      };
    })
  );
  const granules = excObjs.reduce((arr, exc) => arr.concat(exc.originalPayload.granules), []);
  const fileCount = granules.reduce((total, granule) => total + granule.files.length, 0);
  return {
    excObjs: excObjs,
    fileCount: fileCount,
  };
}

/**
 * Generate Long PAN message
 *
 * @param {Object|string[]} executions - List of workflow executions
 * @returns {string} the PAN message
 */
async function generateLongPAN(executions) {
  const timeStamp = new Date();

  const { excObjs, fileCount } = await getExecutionObjs(executions);
  const longPan = new pvl.models.PVLRoot()
    .add('MESSAGE_TYPE', new pvl.models.PVLTextString('LONGPAN'))
    .add('NO_OF_FILES', new pvl.models.PVLNumeric(fileCount));

  for (const exc of excObjs) {
    for (const granule of exc.originalPayload.granules) {
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
  getExecutionObjs,
};
