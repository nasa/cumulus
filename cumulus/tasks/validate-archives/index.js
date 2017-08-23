'use strict';

const log = require('@cumulus/common/log');
const aws = require('@cumulus/common/aws');
const Task = require('@cumulus/common/task');
const validations = require('./archive-validations');
const fs = require('fs');
const path = require('path');
const gunzip = require('gunzip-maybe');
const tarGz = require('targz');
const promisify = require('util.promisify');
const util = require('@cumulus/common/util');
const { spawn, spawnSync, execSync } = require('child_process');
const checksum = require('checksum');

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
    // Vars needed from config to connect to the S3 bucket
    const { s3Bucket } = this.config;

    const message = this.message;
    const { fileAttributes } = await message.payload;

    const tmpDir = util.mkdtempSync(this.constructor.name);

    const archiveFiles = fileAttributes.map(attr => attr.s3Key);
    const downloadRequest = archiveFiles.map(s3Key => ({ Bucket: s3Bucket, Key: s3Key }));

    // Promisify some functions to avoid using callbacks
    const fileChecksum = promisify(checksum.file);
    const decompress = promisify(tarGz.decompress);

    let dispositionPromises;

    try {
      // Download the archive files to the local file system
      await aws.downloadS3Files(downloadRequest, tmpDir);

      dispositionPromises = fileAttributes.map(async fileAttrs => {
        const archiveFilePath = path.join(tmpDir, fileAttrs.s3Key);

        // Validate checksum
        let algorithm = 'md5';
        if (fileAttrs.checksumType.toUpperCase() === 'SHA1') {
          algorithm = 'sha1';
        }
        const cksum = await fileChecksum(archiveFilePath, { algorithm: algorithm });
        if (cksum !== fileAttrs.checksum) {
          return 'CHECKSUM VERIFICATION FAILURE';
        }

        // Extract archive
        const archiveDirPath = archiveFilePath.substr(0, archiveFilePath.length - 4);
        // fs.mkdirSync(archiveDirPath);
        try {
          await decompress(archiveDirPath, archiveFilePath);
        }
        catch (e) {
          return 'FILE I/O ERROR';
        }

        try {
          // Verify that all the files are present
          const unarchivedFiles = fs.readDirSync(archiveDirPath).map(file => file.toUpperCase());
          let hasImage = false;
          let hasWorldFile = false;
          let hasMetadata = false;
          unarchivedFiles.forEach(filePath => {
            const ext = path.extname(filePath);
            if (ext === 'JPG' || ext === 'PNG') hasImage = true;
            if (ext === 'PGW' || ext === 'JGW') hasWorldFile = true;
            if (ext === 'MET') hasMetadata = true;
          });

          if (!hasImage) return 'INCORRECT NUMBER OF SCIENCE FILES';
          if (!hasWorldFile) return 'INCORRECT NUMBER OF FILES';
          if (!hasMetadata) return 'INCORRECT NUMBER OF METADATA FILES';

          // TODO Check for un-parsable metadata file

          // Upload expanded files to S3
          const s3DirKey = fileAttrs.s3Key.substr(0, fileAttrs.s3Key.length - 4);
          aws.uploadS3Files(unarchivedFiles, s3Bucket, s3DirKey);
        }
        catch (e) {
          return 'ECS INTERNAL ERROR';
        }

        return 'SUCCESSFUL';
      });
    }
    finally {
      execSync(`rm -rf ${tmpDir}`);
    }

    return Promise.all(dispositionPromises);
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

// Test code
const local = require('@cumulus/common/local-helpers');
local.setupLocalRun(module.exports.handler, () => ({
  workflow_config_template: {
    DiscoverPdr: {
      s3Bucket: '{resources.s3Bucket}',
      folder: 'PDR'
    },
    ValidateArchives: {
      s3Bucket: '{resources.s3Bucket}',

    }
  },
  resources: {
    s3Bucket: 'gitc-jn-sips-mock'
  },
  provider: {
    id: 'DUMMY',
    config: {}
  },
  meta: {},
  ingest_meta: {
    task: 'ValidateArchives',
    id: 'abc1234',
    message_source: 'stdin'
  }

}));
