'use strict';

const log = require('@cumulus/common/log');
const aws = require('@cumulus/common/aws');
const Task = require('@cumulus/common/task');
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
module.exports = class DownloadActivityMock extends Task {
  /**
   * Main task entry point
   * @return An object referencing the oldest PDR on the server
   */
  async run() {
    // Vars needed from config to connect to the SIPS server (just an S3 bucket for now)
    const { protocol, host, port, user, password, destinationS3Bucket } = this.config;

    const message = this.message;

    const { fileList } = await message.payload;

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
    const resultsPromises = fileList.map(async (fileEntry) => {
      const { directory, fileName, checksumType, checksum, fileType, size } = fileEntry;
      // Remove starting '/' from directory and append fileName and type to make S3 key
      const s3Key = `${directory}/${fileName}.${fileType}`.substring(1);

      try {
        // aws streaming upload is not working with FTP stream for some reason, workaround
        // is to download the file to the file system
        // const fileStream = sips.getFileStream(client, s3Key);
        // await aws.uploadS3FileStream(fileStream, destinationS3Bucket, fileName);

        const downloadPath =
          await sips.downloadFile(client, directory, '/tmp/staging', `${fileName}.${fileType}`);
        log.info(`DOWNLOAD PATH: ${downloadPath}`);
        log.info(`DEST BUCKET:  ${destinationS3Bucket}`);
        await aws.uploadS3Files([downloadPath], destinationS3Bucket, s3Key);

        return [destinationS3Bucket, s3Key, []];
      }
      catch (e) {
        log.error(e);
        return [destinationS3Bucket, s3Key, [e]];
      }
    });

    const results = await Promise.all(resultsPromises);

    // Verify checksums for files


    // Return links to the files [s3Bucket, key] and error messages for each

    return results;
  }

  /**
   * Entry point for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return DownloadActivityMock.handle(...args);
  }
};

// Test code

// const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const local = require('@cumulus/common/local-helpers');
local.setupLocalRun(module.exports.handler, () => ({
  workflow_config_template: {
    DownloadActivityMock: {
      host: 'localhost',
      port: 21,
      protocol: 'ftp',
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      s3Bucket: '{resources.s3Bucket}',
      folder: 'DATA',
      destinationS3Bucket: '{resources.destinationS3Bucket}'
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
    task: 'DownloadActivityMock',
    id: 'abc123',
    message_source: 'stdin'
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

