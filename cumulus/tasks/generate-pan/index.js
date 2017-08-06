'use strict';

const log = require('cumulus-common/log');
const Task = require('cumulus-common/task');
const promisify = require('util.promisify');
const FtpClient = require('ftp');
const SftpClient = require('sftpjs');
const path = require('path');
const sts = require('string-to-stream');
const ftp = require('./ftp_util');
const pan = require('./pan');

/**
 * Task that generates a PAN for a set of files referenced in a PDR
 * Input payload: An array containing entries for each downloaded file
 * Output payload: None
 */
module.exports = class GeneratePan extends Task {
  /**
   * Main task entry point
   * @return Array An array of archive files to be processed
   */
  async run() {
    // Vars needed from config to connect to the SIPS server
    const { protocol, host, port, user, password, folder } = this.config;
    const payload = await this.message.payload;
    const pdrFileName = payload.pdr_file_name;
    const files = payload.files;
    const timeStamp = (new Date()).toISOString().replace(/\.\d\d\dZ/, 'Z');

    const pdrExt = path.extname(pdrFileName);
    log.info(`EXT: ${pdrExt}`);
    const panExt = pdrExt === '.PDR' ? 'PAN' : 'pan';
    const panFileName = `${pdrFileName.substr(0, pdrFileName.length - 4)}.${panExt}`;

    const panStr = pan.generatePan(files, timeStamp);

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

    try {
      const stream = sts(panStr);
      await ftp.uploadFile(client, folder, panFileName, stream);
    }
    catch (e) {
      log.error(e);
      log.error(e.stack);
      throw e;
    }
    finally {
      // Close the connection to the SIPS server
      client.end();
    }

    return { pdr_file_name: pdrFileName };
  }

  /**
   * Entry point for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return GeneratePan.handle(...args);
  }
};

// Test code
const local = require('cumulus-common/local-helpers');
local.setupLocalRun(module.exports.handler, () => ({
  workflow_config_template: {
    DiscoverPdr: {
      host: 'localhost',
      port: 21,
      protocol: 'ftp',
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      folder: 'PDR'
    },
    ValidatePdr: {
      s3Bucket: '{resources.buckets.private}',
      host: 'localhost',
      port: 21,
      protocol: 'ftp',
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      folder: 'PDR'
    },
    GeneratePdrFileList: {
      host: 'localhost',
      port: 21,
      protocol: 'ftp'
    },
    DownloadActivity: {
      skip_upload_output_payload_to_s3: true,
      output: {
        bucket: '{resources.buckets.private}',
        key_prefix: 'sources/EPSG{meta.epsg}/SIPSTEST/{meta.collection}'
      }
    },
    ValidateArchives: {
      s3Bucket: '{resources.buckets.private}'
    },
    GeneratePan: {
      host: 'localhost',
      port: 21,
      protocol: 'ftp',
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      folder: 'PAN'
    },
    DeletePdr: {
      host: 'localhost',
      port: 21,
      protocol: 'ftp',
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      folder: 'PDR'
    }
  },
  resources: {
    buckets: {
      private: 'provgateway-deploy'
    }
  },
  provider: {
    id: 'DUMMY',
    config: {}
  },
  meta: {
    epsg: 4326,
    collection: 'VNGCR_LQD_C1'
  },
  ingest_meta: {
    task: 'GeneratePan',
    id: 'abc123',
    message_source: 'stdin'
  }

}));
