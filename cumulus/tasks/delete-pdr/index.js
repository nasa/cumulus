'use strict';

const log = require('cumulus-common/log');
const Task = require('cumulus-common/task');
const FtpClient = require('ftp');
const SftpClient = require('sftpjs');
const promisify = require('util.promisify');
const ftp = require('./ftp_util');

/**
 * Task that deletes a PDR from a SIPS server
 * Input payload: The path to the PDR on the server
 * Output payload: none
 */
module.exports = class DeletePdr extends Task {
  /**
   * Main task entry point
   * @return An object referencing the oldest PDR on the server
   */
  async run() {
    // Vars needed from config to connect to the SIPS server
    const { type, host, port, username, password } =
     this.message.provider.config.gateway_config.conn_config;
    const folder = this.config.folder;

    // Message payload contains the name of the PDR to be deleted
    const payload = await this.message.payload;
    const pdrFileName = payload.pdr_file_name;

    let client;
    if (type.toUpperCase() === 'FTP') {
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
      await ftp.deleteFile(client, folder, pdrFileName);
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

    log.info(`PDR ${pdrFileName} DELETED`);

    return { pdr_file_name: pdrFileName };
  }

  /**
   * Entry point for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return DeletePdr.handle(...args);
  }
};
