'use strict';

const log = require('@cumulus/common/log');
const aws = require('@cumulus/common/aws');
const Task = require('@cumulus/common/task');
const util = require('@cumulus/common/util');
const validations = require('./archive-validations');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const tarGz = require('targz');
const promisify = require('util.promisify');

// Promisify function to avoid using callbacks
const decompress = promisify(tarGz.decompress);

/**
 * Returns the directory path to which the archive file will be un-archived
 * Ex: /tmp/test.tar.gz => /tmp/test
 * @param {string} archiveFilePath
 * @return {string} The un-archive directory
 */
const archiveDir = archiveFilePath => {
  // archive files must be .tgz or .tar.gz files
  const segments = archiveFilePath.match(/(.*?)(\.tar\.gz|\.tgz)/i);
  return segments[1];
};

/**
 *
 * @param {Array} unarchivedFiles An array of files that were unarchived
 *  @param {string} archiveDirPath The path where the files were extracted
 * @param {Object} fileAttrs An object that contains attributes about the archive file
 */
const uploadArchiveFilesToS3 = async (unarchivedFiles, archiveDirPath, fileAttrs) => {
  const fullFilePaths = unarchivedFiles.map(fileName => path.join(archiveDirPath, fileName));
  const s3DirKey = archiveDir(fileAttrs.target.key);
  return aws.uploadS3Files(fullFilePaths, fileAttrs.target.bucket, s3DirKey);
};

/**
 * Extracts a .tgz file
 * @param {string} tmpDir The path to the directory where the file should be extracted
 * @param {string} archiveFilePath The path to the file to be extracted
 * @return {string} The path to the the directory below `tmpDir` where the files are extracted
 * Throws an exception if there is an error decompressing or un-tarring the file
 */
const extractArchive = async (tmpDir, archiveFilePath) => {
  log.debug(`DECOMPRESSING ${archiveFilePath}`);
  const archiveDirPath = archiveDir(archiveFilePath);
  await decompress({ dest: archiveDirPath, src: archiveFilePath });

  return archiveDirPath;
};

/**
 * Deletes the given files from the local file system
 * @param {Array} unarchivedFiles An array of files that were unarchived
 * @param {string} archiveDirPath The path where the files were extracted
 */
const deleteExpandedFiles = async (unarchivedFiles, archiveDirPath) => {
  unarchivedFiles.forEach(fileName => {
    const fullPath = path.join(archiveDirPath, fileName);
    fs.unlinkSync(fullPath);
  });
};

/**
 * Task that validates the archive files retrieved from a SIPS server
 * Input payload: An array of objects describing the downloaded archive files
 * Output payload: An object possibly containing an `errors` key pointing to an array
 * of error or success messages. A side-effect of this function is that the
 * archive files will be expanded on S3.
 */
module.exports = class ValidateArchives extends Task {
  /**
   * Main task entry point
   * @return {Array} An array of strings, either error messages or 'SUCCESSFUL'
   */
  async run() {
    const message = this.message;
    const payload = await message.payload;
    const files = payload.files;
    const pdrFileName = payload.pdr_file_name;

    // Create a directory for the files to be downloaded
    const tmpDir = util.mkdtempSync(this.constructor.name);

    // Only files that were successfully downloaded by the provider gateway will be processed
    const archiveFiles = files
      .filter(file => file.success)
      .map(file => [file.target.bucket, file.target.key]);

    const downloadRequest = archiveFiles.map(([s3Bucket, s3Key]) => ({
      Bucket: s3Bucket,
      Key: s3Key
    }));

    try {
      // Download the archive files to the local file system
      await aws.downloadS3Files(downloadRequest, tmpDir);

      const downloadedFiles = fs.readdirSync(tmpDir);
      log.debug(`FILES: ${JSON.stringify(downloadedFiles)}`);

      let imageSources = [];

      // Compute the dispositions (status) for each file downloaded successfully by
      // the provider gateway
      const dispositionPromises = files.map(async fileAttrs => {
        // Only process archives that were downloaded successfully by the provider gateway
        if (fileAttrs.success) {
          const archiveFileName = path.basename(fileAttrs.target.key);
          const archiveFilePath = path.join(tmpDir, archiveFileName);
          const returnValue = Object.assign({}, fileAttrs, { success: false });

          // Validate checksum
          const cksumError = await validations.validateChecksum(fileAttrs, archiveFilePath);
          if (cksumError) {
            return Object.assign(returnValue, { error: cksumError });
          }

          // Extract archive
          let archiveDirPath;
          try {
            archiveDirPath = await extractArchive(tmpDir, archiveFilePath);
            log.debug(`UNARCHIVED PATH: ${archiveDirPath}`);
          }
          catch (e) {
            log.error(e);
            return Object.assign(returnValue, { error: 'FILE I/O ERROR' });
          }

          try {
            // Verify that all the files are present
            let unarchivedFiles;
            try {
              unarchivedFiles = validations.validateArchiveContents(archiveDirPath);
              log.debug(`UNARCHIVED FILES: ${JSON.stringify(unarchivedFiles)}`);
            }
            catch (e) {
              log.error(e);
              return Object.assign(returnValue, { error: e.message });
            }

            // Upload expanded files to S3
            const s3Files = await uploadArchiveFilesToS3(
              unarchivedFiles,
              archiveDirPath,
              fileAttrs
            );
            log.info('S3 FILES:');
            log.info(JSON.stringify(s3Files));

            const imgFiles = s3Files.map(s3File => ({ Bucket: s3File.bucket, Key: s3File.key }));

            if (imgFiles.length > 0) {
              imageSources.push({ archive: archiveFileName, images: imgFiles });
            }

            // delete the local expanded files
            deleteExpandedFiles(unarchivedFiles, archiveDirPath);

            // Delete the archive files from S3
            await aws.deleteS3Files(downloadRequest);
          }
          catch (e) {
            log.error(e);
            log.error(e.stack);
            return Object.assign(returnValue, { error: 'ECS INTERNAL ERROR' });
          }

          return fileAttrs;
        }

        // File was not downloaded successfully by provider gateway so just pass along its status
        return fileAttrs;
      });

      // Have to wait here or the directory holding the archives might get deleted before
      // we are done (see finally block below)
      const dispositions = await Promise.all(dispositionPromises);


      log.debug(`Found ${imageSources.length} images for MRFGen`);

      return { pdr_file_name: pdrFileName, files: dispositions, sources: imageSources };
    }
    finally {
      execSync(`rm -rf ${tmpDir}`);
    }
  }

  /**
   * Entry point for Lambda
   * @param {array} args The arguments passed by AWS Lambda
  * @return The handler return value
   */
  static handler(...args) {
    return ValidateArchives.handle(...args);
  }
};
