'use strict';

/**
 * Validations for PDR entries
 */

 /**
  * File spec validations - validations for individual files
  */

/**
 * Validates that the DIRECTORY_ID values for FILE_SPEC entries is neither missing nor empty
 * @param {PVLObject} fileSpec
 * @return {string} An error string or null
 */
const directoryIdValidation = fileSpec => {
  const directoryId = fileSpec.get('DIRECTORY_ID');

  return (!directoryId || directoryId.value === '') ? 'INVALID DIRECTORY' : null;
};

const fileSpecValidations = [directoryIdValidation];

/**
 * Performs a series of validations on a file group
 * @param {PVLObject} fileGroup A `PVLObject` object representing a file group entry
 * @return {Array} An (possibly empty) array of error strings.
 */
const validateFileSpec = fileSpec =>
  fileSpecValidations.map(validationFn => validationFn(fileSpec)).filter(err => err);

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
  // TODO Need to check that DATA_TYPE and VERSION_ID correspond to an Imagery Product
  // TODO Need to add check for empty/missing VERSION_ID
  if (!dataType || dataType.value === '') {
    rval = 'INVALID_DATA_TYPE';
  }

  return rval;
};

const fileGroupValidations = [dataTypeValidation];

/**
 * Performs a series of validations on a file group
 * @param {PVLObject} fileGroup A `PVLObject` object representing a file group entry
 * @return {Array} An (possibly empty) array of error strings.
 */
exports.validateFileGroup = fileGroup => {
  const fileGroupErrors = fileGroupValidations.map(validationFn => validationFn(fileGroup))
    .filter(err => err);
  if (fileGroupErrors.length > 0) {
    return fileGroupErrors;
  }
  // No errors in file group parameters, so validate each FILE_SPEC in the FILE_GROUP
  const fileSpecs = fileGroup.objects('FILE_SPEC');
  const fileSpecErrors = [];
  fileSpecs.forEach(fileSpec => {
    const fileErrors = validateFileSpec(fileSpec);
    if (fileErrors.length > 0) {
      // Only need one error
      fileSpecErrors.push(fileErrors[0]);
    }
  });

  return fileSpecErrors;
};

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
