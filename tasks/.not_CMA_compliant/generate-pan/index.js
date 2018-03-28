'use strict';

const log = require('@cumulus/common/log');
const Task = require('@cumulus/common/task');
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
    const { conn_type, host, port, username, password } =
     this.message.provider.config.gateway_config.conn_config;

    const folder = this.config.folder;
    const payload = await this.message.payload;
    const pdrFileName = payload.pdr_file_name;
    log.info(`Generating PAN for PDR ${pdrFileName}`);
    const files = payload.files;
    const timeStamp = (new Date()).toISOString().replace(/\.\d\d\dZ/, 'Z');

    const pdrExt = path.extname(pdrFileName);
    const panExt = pdrExt === '.PDR' ? 'PAN' : 'pan';
    const panFileName = `${pdrFileName.substr(0, pdrFileName.length - 4)}.${panExt}`;

    const panStr = pan.generatePan(files, timeStamp);

    let client;
    if (conn_type.toUpperCase() === 'FTP') {
      client = new FtpClient();
    }
    else {
      client = new SftpClient();
    }

    const clientReady = promisify(client.once).bind(client);

    client.connect({
      host: host,
      port: port,
      user: username,
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

    // pass the payload to the next task, if any
    return payload;
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
