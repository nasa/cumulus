//@ts-check

'use strict';

const isObject = require('lodash/isObject');
const pvl = require('@cumulus/pvl');
const { getExecution } = require('@cumulus/api-client/executions');

/**
 * @typedef {object} FailedExecution
 * @property {string} arn
 * @property {string} reason
 */

/**
 * @typedef {FailedExecution | string } Execution
 */

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

const granulesFileCount = (granules) => granules.reduce((sum, { files }) => sum + files.length, 0);

/**
 * Generate Long PAN message
 *
 * @param {Execution[]} executions - List of workflow executions
 * @param {Function|undefined} getExecutionFunction - function for testing. Defaults to getExecution
 * @returns {Promise<string>} the PAN message
 */
async function generateLongPAN(executions, getExecutionFunction = getExecution) {
  const timeStamp = new Date();

  const executionsWithGranules = await Promise.all(
    executions.map(async (exc) => {
      const isFailedExecObj = isObject(exc);
      const arn = isFailedExecObj ? exc.arn : exc;
      const reason = isFailedExecObj ? exc.reason : undefined;
      const excObj = await getExecutionFunction({
        prefix: process.env.stackName,
        arn,
      });
      const granules = excObj.originalPayload?.granules || [];
      return { arn, granules, reason };
    })
  );

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
};
