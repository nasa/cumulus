'use strict';

/**
 * Validations for PDR entries
 */

/**
 * File group validations
 */

/**
 * Validates the DISPLAY_TYPE entry for a file group
 * @param {PVLObject} fileGroup A `PVLObject` object representing a file group entry
 * @return {string} An error string or null
 */
const dataTypeValidation = fileGroup => {
  const dataType = fileGroup.get('DATA_TYPE');
  const versionId = fileGroup.get('VERSION_ID');

  let rval = null;
  // TODO Need to check that dataType and versionId correspond to an Imagery Product
  if (!dataType || dataType.value === '' || !versionId) {
    rval = ['INVALID_DATA_TYPE'];
  }

  return rval;
};

/**
 * Validates that the DIRECOTRY_ID value is neither missing nor empty
 * @param {PVLObject} fileGroup
 * @return {string} An error string or null
 */
const directoryIdValidation = fileGroup => {
  const directoryId = fileGroup.get('DIRECTORY_ID');

  let rval = null;
  if (!directoryId || directoryId.value === '') {
    rval = 'INVALID DIRECTORY';
  }

  return rval;
};

const fileGroupValidations = [dataTypeValidation, directoryIdValidation];

/**
 * Performs a series of validations on a file group
 * @param {PVLObject} fileGroup A `PVLObject` object representing a file group entry
 * @return {Array} An (possibly empty) array of error strings.
 */
exports.validateFileGroup = fileGroup =>
  fileGroupValidations.map(validationFn => validationFn(fileGroup)).filter(err => err);

/**
 * Top level (non file group) PDR validations
 */

 /**
  * Validate that the TOTAL_FILE_COUNT entry for the PDR is neither missing nor less than one
  * @param {PVLRoot} pdr The `PVLRoot` object for the PDR
  * @return An error string or null
  */
const fileCountValidation = pdr => {
  let rval = null;
  if (!pdr.get('TOTAL_FILE_COUNT') || pdr.get('TOTAL_FILE_COUNT').value < 1) {
    rval = 'INVALID FILE COUNT';
  }

  return rval;
};

const pdrTopLevelValidations = [fileCountValidation];

/**
 * Performs a series of top-level validations on a PDR
 */
exports.validateTopLevelPdr = pdr =>
  pdrTopLevelValidations.map(validationFn => validationFn(pdr)).filter(err => err);
