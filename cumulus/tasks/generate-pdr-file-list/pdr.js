'use strict';

const pvl = require('pvl');

const fileSpecFields =
  ['DIRECTORY_ID', 'FILE_ID', 'FILE_CKSUM_TYPE', 'FILE_CKSUM_VALUE', 'FILE_TYPE', 'FILE_SIZE'];

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
  const [directory, fileName, checksumType, checksum, fileType, size] =
    fileSpecFields.map((field) => fileSpec.get(field).value);

  return {
    type: 'download',
    source: {
      // TODO url encode this
      // TODO this should work for sftp as well
      url: `ftp://${host}:${port}${directory}/${fileName}.${fileType}`,
      checksumType: checksumType,
      checksum: checksum,
      size: size
    },
    target: 'FROM_CONFIG',
  };
};
