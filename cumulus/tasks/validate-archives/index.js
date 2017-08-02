'use strict';

const log = require('cumulus-common/log');
const aws = require('cumulus-common/aws');
const Task = require('cumulus-common/task');
const validations = require('./archive-validations');
const fs = require('fs');
const path = require('path');
const gunzip = require('gunzip-maybe');
const tar = require('tar-stream');
const promisify = require('util.promisify');

/**
 * Task that validates the archive files retrieved from a SIPS server
 * Input payload: An array of objects describing the downloaded archive files
 * Output payload: An object possibly containing an `errors` key pointing to an array
 * of error or success messages.
 */
module.exports = class ValidateArchives extends Task {
  /**
   * Main task entry point
   * @return {Array} An array of strings, either error messages or 'SUCCESSFUL'
   */
  async run() {
    // Vars needed from config to connect to the S3 bucket
    const { s3Bucket } = this.config;

    // Decompress the archives
    const message = this.message;
    const { fileAttributes } = await message.payload;

    const archiveFiles = fileAttributes.map(attr => attr.s3Key);

    const unArchiveErrorPromises = archiveFiles.map(s3Key => {
      const promise = new Promise();
      let msg = null;
      try {
        // TODO convert these streams to promises to try to process them in 'parallel'
        const extract = tar.extract();

        extract.on('entry', async (header, stream, next) => {
          const fileName = header.name;
          // Upload the stream to the S3 bucket
          log.info(`Uploading ${fileName} to S3 bucket ${s3Bucket}`);
          await aws.uploadS3FileStream(s3Bucket, stream, fileName);
          next();
        });

        extract.on('error', (err) => {
          promise.resolve(err);
        });

        extract.on('finish', () => {
          log.info(`Finished un-archiving ${s3Key}`);
          promise.resolve(msg);
        });

        // Get a stream for the file
        const stream = aws.s3.getObject({ Bucket: s3Bucket, Key: s3Key }).createReadStream();
        // Pipe the stream through a de-compressor then pipe the decompressed stream through the
        // extract stream
        stream.pipe(gunzip()).pipe(extract);

        return 'SUCCESSFUL';
      }
      catch (e) {
        return e;
      }
    });


    // // Do a top-level validation
    // const topLevelErrors = pdrValid.validateTopLevelPdr(pdrObj);
    // if (topLevelErrors.length > 0) {
    //   return { topLevelErrors: topLevelErrors };
    // }

    // // Validate each file group entry
    // const fileGroups = pdrObj.objects('FILE_GROUP');
    // const fileGroupErrors = fileGroups.map(pdrValid.validateFileGroup);
    // if (fileGroupErrors.some((value) => value.length > 0)) {
    //   return { fileGroupErrors: fileGroupErrors };
    // }

    // // No errors so pass along the list of paths to the archive files.
    // const fileList = [];
    // fileGroups.forEach((fileGroup) => {
    //   const fileSpecs = fileGroup.objects('FILE_SPEC');
    //   fileSpecs.forEach((fileSpec) => {
    //     const fileEntry =
    //       pdrMod.fileSpecToFileEntry(fileSpec, host, port, user, password, s3Bucket);
    //     fileList.push(fileEntry);
    //   });
    // });

    // return fileList;
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
const local = require('cumulus-common/local-helpers');
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
