'use strict';

const log = require('cumulus-common/log');
const aws = require('cumulus-common/aws');
const Task = require('cumulus-common/task');
const FtpClient = require('ftp');
const SftpClient = require('sftpjs');
const pdrMod = require('./pdr');
const pdrValid = require('./pdr-validations');

/**
 * Task that validates a PDR retrieved from a SIPS server
 * Input payload: An object containing the PDR to process
 * Output payload: An object possibly containing a `topLevelErrors` key pointing to an array
 * of error messages, a `fileGroupErrors` key pointing to an array of error messages, or
 * a list of paths to files to be downloaded. The original input pdr is included in the output
 * payload.
 */
module.exports = class ValidatePdr extends Task {
  /**
   * Main task entry point
   * @return Array An array of archive files to be processed
   */
  async run() {
    // Vars needed from config to connect to the SIPS server (just an S3 bucket for now)
    const message = this.message;

    log.info('MESSAGE');
    log.info(message);

    // Download the PDR
    // const pdr = await aws.downloadS3Files([{ Bucket: s3Bucket, Key: s3Key }], '/tmp');
    const { fileName, pdr } = await message.payload;

    // Parse the PDR and do a preliminary validation
    let pdrObj;
    try {
      pdrObj = pdrMod.parsePdr(pdr);
    }
    catch (e) {
      log.error(e);
      log.error(e.stack);
      return { errors: ['INVALID PVL STATEMENT'] };
    }

    // Do a top-level validation
    const topLevelErrors = pdrValid.validateTopLevelPdr(pdrObj);
    if (topLevelErrors.length > 0) {
      return { topLevelErrors: topLevelErrors };
    }

    // Validate each file group entry
    const fileGroups = pdrObj.objects('FILE_GROUP');
    const fileGroupErrors = fileGroups.map(pdrValid.validateFileGroup);
    if (fileGroupErrors.some((value) => value.length > 0)) {
      return { fileGroupErrors: fileGroupErrors };
    }

    // No errors so pass along the list of paths to the archive files.
    const fileList = [];
    fileGroups.forEach((fileGroup) => {
      const fileSpecs = fileGroup.objects('FILE_SPEC');
      fileSpecs.forEach((fileSpec) => {
        const fileEntry = pdrMod.fileSpecToFileEntry(fileSpec);
        fileList.push(fileEntry);
      });
    });

    return { fileList: fileList };
  }

  /**
   * Entry point for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return ValidatePdr.handle(...args);
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
    ValidatePdr: {
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
    task: 'ValidatePdr',
    id: 'abc1234',
    message_source: 'stdin'
  }

}));
