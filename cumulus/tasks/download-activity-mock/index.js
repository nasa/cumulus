'use strict';

const log = require('cumulus-common/log');
const aws = require('cumulus-common/aws');
const Task = require('cumulus-common/task');
const promisify = require('util.promisify');
const FtpClient = require('ftp');
const SftpClient = require('sftpjs');
const sips = require('./sips');

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
    const { protocol, host, port, user, password, destinationS3Bucket } = this.config;

    const message = this.message;

    // TEST

    const { files } = await message.payload;

    // Open a connection to the SIPS server
    let client;
    if (protocol.toUpperCase() === 'FTP') {
      client = new FtpClient();
    }
    else {
      client = new SftpClient();
    }

    const clientReady = promisify(client.once).bind(client);

    client.connect({
      host: host,
      port: port,
      user: user,
      password: password
    });

    await clientReady('ready');

    // Download all the files
    let results = files.map((file) => {
      const fileStream = sips.getFileStream(client, file);
      return 1;
    });

    // Verify checksums for files

    // Return links to the files [s3Bucket, key] and error messages for each

    // const s3Key = pdrInfo.Key;
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

