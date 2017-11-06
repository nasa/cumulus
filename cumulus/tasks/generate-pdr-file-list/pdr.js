'use strict';

const pvl = require('@cumulus/pvl/t');

const fileSpecFields =
  ['DIRECTORY_ID', 'FILE_ID', 'FILE_CKSUM_TYPE', 'FILE_CKSUM_VALUE', 'FILE_SIZE'];

/**
 * Parses a PDR, performing validation and returning a list of file paths
 * @param {string} pdr The text of the PDR
 * @return {PVLRoot} An object representing a PDR
 * @throws {Error} Throws an Error if parsing fails
 */
exports.parsePdr = pdr => pvl.pvlToJS(pdr);

/**
 * Convert a PVL FILE_SPEC entry into an object with enough information to download the
 * associated file and verify it
 * @param {PVLObject} fileSpec An object containing the FILE_SPEC data
 * @return {Object} An object containing the FILE_SPEC data needed for downloading the archive file
 */
exports.fileSpecToFileEntry = (fileSpec, host, port) => {
  // fileSpec is a PVLObject, so we have to use its getters to get values
  const [directory, fileName, checksumType, checksum, size] =
    fileSpecFields.map((field) => fileSpec.get(field).value);

  return {
    type: 'download',
    source: {
      url: `ftp://${host}:${port}${directory}/${fileName}`,
      checksumType: checksumType,
      checksum: checksum,
      size: size
    },
    target: 'FROM_CONFIG'
  };
};

/**
 * Parse a PDR text and return a list of file descriptions for the files listed in the PDR
 * @param {string} pdrStr The text of the PDR
 * @param {string} host The SIPS hostname / IP address
 * @param {number} port The port of the SIPS host
 * @return {Array} An array of information for each file
 */
exports.pdrToFileList = (pdrStr, host, port) => {
  const pdrObj = exports.parsePdr(pdrStr);
  const fileGroups = pdrObj.objects('FILE_GROUP');
  const fileList = [];
  fileGroups.forEach((fileGroup) => {
    const fileSpecs = fileGroup.objects('FILE_SPEC');
    fileSpecs.forEach((fileSpec) => {
      const fileEntry =
        exports.fileSpecToFileEntry(fileSpec, host, port);
      fileList.push(fileEntry);
    });
  });

  return fileList;
};
