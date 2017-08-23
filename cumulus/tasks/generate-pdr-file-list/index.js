'use strict';

const Task = require('@cumulus/common/task');
const pdrMod = require('./pdr');

/**
 * Task that validates a PDR retrieved from a SIPS server
 * Input payload: An object containing the PDR to process
 * Output payload: An object possibly containing a `topLevelErrors` key pointing to an array
 * of error messages, a `fileGroupErrors` key pointing to an array of error messages, or
 * a list of paths to files to be downloaded. The original input pdr is included in the output
 * payload.
 */
module.exports = class GeneratePdrFileList extends Task {
  /**
   * Main task entry point
   * @return Array An array of archive files to be processed
   */
  async run() {
    // Vars needed from config to connect to the SIPS server
    const { host, port } =
     this.message.provider.config.gateway_config.conn_config;

    // Message payload contains the PDR
    const message = this.message;
    const payload = await message.payload;
    const pdr = payload.pdr;
    const pdrFileName = payload.pdr_file_name;

    const pdrObj = pdrMod.parsePdr(pdr);
    const fileGroups = pdrObj.objects('FILE_GROUP');
    const fileList = [];
    fileGroups.forEach((fileGroup) => {
      const fileSpecs = fileGroup.objects('FILE_SPEC');
      fileSpecs.forEach((fileSpec) => {
        const fileEntry =
          pdrMod.fileSpecToFileEntry(fileSpec, host, port);
        fileList.push(fileEntry);
      });
    });

    return {
      pdr_file_name: pdrFileName,
      files: fileList
    };
  }

  /**
   * Entry point for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return GeneratePdrFileList.handle(...args);
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
    GeneratePdrFileList: {
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
    task: 'GeneratePdrFileList',
    id: 'abc1234',
    message_source: 'stdin'
  }

}));
