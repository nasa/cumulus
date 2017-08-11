'use strict';

/**
 * Validations for PDR entries
 */

 /**
  * File spec validations - validations for individual files
  */

/**
 * Validates that the DIRECTORY_ID value for FILE_SPEC entry is neither missing nor empty
 * @param {PVLObject} fileSpec
 * @return {string} An error string or null
 */
const directoryIdValidation = fileSpec => {
  const directoryId = fileSpec.get('DIRECTORY_ID');

  return !directoryId || directoryId.value === '' ? 'INVALID DIRECTORY' : null;
};

/**
 * Validates that the DIRECTORY_ID value for FILE_SPEC entry is neither missing nor < 1
 * @param {PVLObject} fileSpec
 * @return {string} An error string or null
 */
const fileSizeValidation = fileSpec => {
  const fileSize = fileSpec.get('FILE_SIZE');

  return !fileSize || fileSize.value < 1 ? 'INVALID FILE SIZE' : null;
};

/**
 * Validates that the DIRECTORY_ID value for FILE_SPEC entry is neither missing nor empty
 * @param {PVLObject} fileSpec
 * @return {string} An error string or null
 */
const fileIdValidation = fileSpec => {
  const fileId = fileSpec.get('FILE_ID');

  return !fileId || fileId.value === '' ? 'INVALID FILE ID' : null;
};

/**
 * Validates that the FILE_TYPE value for FILE_SPEC entry is neither missing nor empty
 * @param {PVLObject} fileSpec
 * @return {string} An error string or null
 */
const fileTypeValidation = fileSpec => {
  const fileType = fileSpec.get('FILE_TYPE');

  return !fileType || fileType.value === '' ? 'INVALID FILE TYPE' : null;
};

/**
 * Validates that the FILE_CKSUM_TYPE value for FILE_SPEC entry is neither missing nor empty
 * @param {PVLObject} fileSpec
 * @return {string} An error string or null
 */
const fileCksumTypeMissingValidation = fileSpec => {
  const cksumType = fileSpec.get('FILE_CKSUM_TYPE');

  return !cksumType || cksumType.value === '' ? 'MISSING FILE_CKSUM_TYPE PARAMETER' : null;
};

/**
 * Validates that the FILE_CKSUM_TYPE value for FILE_SPEC entry is a supported type
 * @param {PVLObject} fileSpec
 * @return {string} An error string or null
 */
const fileCksumTypeValidation = fileSpec => {
  const cksumTypeStr = fileSpec.get('FILE_CKSUM_TYPE');
  const cksumType = cksumTypeStr ? cksumTypeStr.value : null;
  return cksumType === 'MD5' || cksumType === 'SHA1' ? null : 'UNSUPPORTED CHECKSUM TYPE';
};

/**
 * Validates that the FILE_CKSUM value for FILE_SPEC entry is neither missing nor empty
 * @param {PVLObject} fileSpec
 * @return {string} An error string or null
 */
const fileCksumValueMissingValidation = fileSpec => {
  const cksum = fileSpec.get('FILE_CKSUM_VALUE');

  return (!cksum || cksum.value === '') ? 'MISSING FILE_CKSUM_VALUE PARAMETER' : null;
};

/**
 * Validates that the FILE_CKSUM value for FILE_SPEC entry has the right form
 * @param {PVLObject} fileSpec
 * @return {string} An error string or null
 */
const fileCksumValueValidation = fileSpec => {
  const cksum = fileSpec.get('FILE_CKSUM_VALUE');
  const cksumType = fileSpec.get('FILE_CKSUM_TYPE');
  let regex = /^[0-9a-f]{40}$/;
  if (cksumType.value === 'MD5') {
    regex = /^[0-9a-f]{32}$/;
  }

  return cksum.match(regex) ? null : 'INVALID FILE_CKSUM_VALUE';
};

const fileSpecValidations = [
  directoryIdValidation,
  fileSizeValidation,
  fileIdValidation,
  fileTypeValidation,
  fileCksumTypeMissingValidation,
  fileCksumTypeValidation,
  fileCksumValueMissingValidation,
  fileCksumValueValidation
];

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
 * Validates the DATA_TYPE entry for a file group
 * @param {PVLObject} fileGroup A `PVLObject` object representing a file group entry
 * @return {string} An error string or null
 */
const dataTypeValidation = fileGroup => {
  const dataType = fileGroup.get('DATA_TYPE');

  let rval = null;
  if (!dataType) {
    rval = 'INVALID_DATA_TYPE';
  }

  return rval;
};

/**
 * Validates the VERSION_ID entry for a file group
 * @param {PVLObject} fileGroup A `PVLObject` object representing a file group entry
 * @return {string} An error string or null
 */
const versionIdValidation = fileGroup => {
  const versionId = fileGroup.get('VERSION_ID');

  let rval = null;
  if (!versionId) {
    rval = 'INVALID_DATA_TYPE';
  }

  return rval;
};

const fileGroupValidations = [dataTypeValidation, versionIdValidation];

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
