'use strict';

const log = require('@cumulus/common/log');
const checksum = require('checksum');
const promisify = require('util.promisify');
const fs = require('fs');
const path = require('path');

// Promisify function to avoid using callbacks
const fileChecksum = promisify(checksum.file);

/**
 * Validate the checksum
 * @param {Object} fileAttrs Object describing a file as processed by the provider gateway
 * @param {string} archiveFilePath The path to the archive file on the local file system
 * @return {string} An error string, or null if the checksum validates correctly
 */
exports.validateChecksum = async (fileAttrs, archiveFilePath) => {
  let algorithm = 'md5';
  if (fileAttrs.source.checksumType.toUpperCase() === 'SHA1') {
    algorithm = 'sha1';
  }

  const cksum = await fileChecksum(archiveFilePath, { algorithm: algorithm });

  return (cksum !== fileAttrs.source.checksum) ? 'CHECKSUM VERIFICATION FAILURE' : null;
};

/**
 * Validate that all the expected file types are present in an archive
 * @param {string} archiveDirPath The path where the files were extracted
 * @return { Array } An Array of strings for the files in the archive
 * Throws an error if a file is missing
 */
exports.validateArchiveContents = (archiveDirPath) => {
  log.debug(`CHECKING CONTENTS OF [${archiveDirPath}]`)
  // Tar files created on Macs sometimes have extra files in them to store
  // extended attribute data. These extra files start with ._, so we filter these
  // out here.
  const unarchivedFiles = fs
    .readdirSync(archiveDirPath)
    .filter(fileName => !fileName.startsWith('._'));

  log.debug(`UNARCHIVED FILES: ${JSON.stringify(unarchivedFiles)}`);

  let hasImage = false;
  let hasWorldFile = false;
  let hasMetadata = false;
  unarchivedFiles.forEach(filePath => {
    log.debug(filePath);
    const ext = path.extname(filePath).toUpperCase();
    if (ext === '.JPG' || ext === '.PNG') hasImage = true;
    if (ext === '.PGW' || ext === '.JGW') hasWorldFile = true;
    if (ext === '.MET') hasMetadata = true;
  });

  const errMsg =
    (!hasImage && 'INCORRECT NUMBER OF SCIENCE FILES') ||
    (!hasWorldFile && 'INCORRECT NUMBER OF FILES') ||
    (!hasMetadata && 'INCORRECT NUMBER OF METADATA FILES');

  if (errMsg) throw errMsg;

  return unarchivedFiles;
};
