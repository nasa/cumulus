'use strict';

const log = require('cumulus-common/log');
const aws = require('cumulus-common/aws');
const Task = require('cumulus-common/task');
const pdrMod = require('./pdr');

/**
 * Task that retrieves PDRs from a SIPS server
 * Input payload: none
 * Output payload: A single object with keys `file` and `pdr` referencing the oldest PDR
 * on the SIPS server
 */
module.exports = class DownloadArchiveFiles extends Task {
  /**
   * Main task entry point
   * @return An object referencing the oldest PDR on the server
   */
  async run() {
    // Vars needed from config to connect to the SIPS server (just an S3 bucket for now)
    const { s3Bucket, folder, destinationS3Bucket } = this.config;

    const message = this.message;

    const { fileName, pdr } = await message.payload;

    // Create a list of files from pdr


    // Return the oldest
    const pdrInfo = pdrList.sort((obj1, obj2) => {
      const lastModStr1 = obj1.LastModified;
      const lastModStr2 = obj2.LastModified;
      const lastMod1 = new Date(lastModStr1);
      const lastMod2 = new Date(lastModStr2);

      return lastMod1 < lastMod2;
    })[0];

    const s3Key = pdrInfo.Key;
    // const { fileName, pdr } = await pdrMod.getPdr(s3Bucket, s3Key);

    return {
      file: fileName,
      pdr: pdr
    };
  }

  /**
   * Entry point for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return DownloadArchiveFiles.handle(...args);
  }
};

// Test code

// const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const local = require('cumulus-common/local-helpers');
local.setupLocalRun(module.exports.handler, () => ({
  workflow_config_template: {
    DownloadArchiveFiles: {
      s3Bucket: '{resources.s3Bucket}',
      folder: 'DATA',
      destinationS3Bucket: '{resources.destinationS3Bucket'
    },
    ProcessPdr: {
      s3Bucket: '{resources.s3Bucket}'
    }
  },
  resources: {
    s3Bucket: 'gitc-jn-sips-mock',
    destinationS3Bucket: 'gitc-jn-sips-mock-downloads'
  },
  provider: {
    id: 'DUMMY',
    config: {}
  },
  meta: {},
  ingest_meta: {
    task: 'DownloadArchiveFiles',
    id: 'abc123',
    message_source: 'local'
  }

}));

// const config = {
//   s3Bucket: 'gitc-jn-sips-mock',
//   folder: 'PDR'
// };

// const DownloadArchiveFiles = module.exports;
// const DownloadArchiveFiles = new DownloadArchiveFiles(null, config, null, null);

// const demo = async () => {
//   while (true) {
//     log.info(await DownloadArchiveFiles.run());
//     await sleep(10000);
//   }
// };

// demo();

