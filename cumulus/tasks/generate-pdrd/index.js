'use strict';

const log = require('cumulus-common/log');
const aws = require('cumulus-common/aws');
const Task = require('cumulus-common/task');
const path = require('path');
const promisify = require('util.promisify');
const FtpClient = require('ftp');
const SftpClient = require('sftpjs');
const sts = require('string-to-stream');
const ftp = require('./ftp_util');
const pdrdMod = require('./pdrd');

/**
 * Task that generates a PDRD for a failing PDR and uploads it to the SIPS server
 * Input payload: An object possibly containing a `topLevelErrors` key pointing to an array
 * of error messages or a `fileGroupErrors` key pointing to an array of error messages.
 * The original input pdr is included in the payload.
 * Output payload: An empty array
 */
module.exports = class GeneratePdrd extends Task {
  /**
   * Main task entry point
   * @return Array An array of archive files to be processed
   */
  async run() {
    // Vars needed from config to connect to the SIPS server
    const { protocol, host, port, user, password, folder } = this.config;

    // Message contains the status of the PDR
    const payload = await this.message.payload;
    const pdrFileName = payload.pdr_file_name;
    const topLevelErrors = payload.top_level_errors;
    const fileGroupErrors = payload.file_group_errors;
    const pdrExt = path.extname(pdrFileName);
    const pdrdExt = pdrExt === '.PDR' ? 'PDRD' : 'pdrd';
    const pdrdFileName = `${pdrFileName.substr(0, pdrFileName.length - 4)}.${pdrdExt}`;
    const pdrdStr = pdrdMod.generatePdrd(topLevelErrors, fileGroupErrors);

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
      const stream = sts(pdrdStr);
      await ftp.uploadFile(client, folder, pdrdFileName, stream);
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

    return { pdrd_file_name: pdrdFileName };
  }

  /**
   * Entry point for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return GeneratePdrd.handle(...args);
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
    GeneratePdrd: {
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
    task: 'GeneratePdrd',
    id: 'abc123',
    message_source: 'stdin'
  }

}));
