'use strict';

const log = require('cumulus-common/log');
const aws = require('cumulus-common/aws');
const Task = require('cumulus-common/task');
const FtpClient = require('ftp');
const SftpClient = require('sftpjs');
const pdrMod = require('./pdr');

/**
 * Task that retrieves a PDR from a SIPS server and processes it
 * Input payload: An object containing information about the PDR to process
 * Output payload: An object containing either an `errors` key pointing to an array of
 * errors or a `files` key pointing to an array of archive files to be downloaded.
 */
module.exports = class ProcessPdr extends Task {
  /**
   * Main task entry point
   * @return Array An array of archive files to be processed
   */
  async run() {
    // Vars needed from config to connect to the SIPS server (just an S3 bucket for now)
    const message = this.message;

    const { s3Bucket } = this.config;
    log.info('MESSAGE');
    log.info(message);
    const s3Key = message.payload.Key;

    // Download the PDR
    // const pdr = await aws.downloadS3Files([{ Bucket: s3Bucket, Key: s3Key }], '/tmp');
    const { fileName, pdr } = await pdrMod.getPdr(s3Bucket, s3Key);
    log.info('PDR');
    log.info(pdr);

    // Parse the PDR and do a preliminary validation
    let pdrObj;
    try {
      pdrObj = pdrMod.parsePdr(pdr);
    }
    catch (e) {
      log.error(e);
      return { errors: ['INVALID PVL STATEMENT'] };
    }

    // Do a top-level validation
    const topLevelErrors = pdrValid.validateTopLevelPdr(pdrObj);
    if (topLevelErrors.length > 0) {
      return { topLevelErrors: topLevelErrors };
    }

    // Validate each file group entry
    const fileGroups = pdrObj.object('FILE_GROUP');
    const fileGroupErrors = fileGroups.map(pdrValid.validateFileGroup);
    if (fileGroupErrors.some((value) => value.length > 0)) {
      return { fileGroupErrors: fileGroupErrors };
    }

    // Get the file list
    const fileInfo = fileGroups.map((fileGroup) => ({

    }));
    return pdrObj;

    // TODO extension (PDRD or pdrd) must match case of extension of original PDR file name
  }

  /**
   * Entry point for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return ProcessPdr.handle(...args);
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
    ProcessPdr: {
      s3Bucket: '{resources.s3Bucket}'
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
    task: 'ProcessPdr',
    id: 'abc123',
    message_source: 'stdin'
  }

}));
