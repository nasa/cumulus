'use strict';

const log = require('cumulus-common/log');
const Task = require('cumulus-common/task');
const FtpClient = require('ftp');
const SftpClient = require('sftpjs');
const promisify = require('util.promisify');

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
    const { protocol, host, port, user, password } = this.config;

    // Message payload contains the path to the PDR to be deleted
    const message = this.message;
    const { pdrPath } = await message.payload;

    let client;
    if (protocol.toUpperCase() === 'FTP') {
      client = new FtpClient();
    }
    else {
      client = new SftpClient();
    }

    const clientReady = promisify(client.once).bind(client);
    const del = promisify(client.delete).bind(client);

    client.connect({
      host: host,
      port: port,
      user: user,
      password: password
    });

    await clientReady('ready');

    await del(pdrPath);
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

// Test code

// const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const local = require('cumulus-common/local-helpers');
local.setupLocalRun(module.exports.handler, () => ({
  workflow_config_template: {
    DeletePdr: {
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
    task: 'DeletePdr',
    id: 'abc123',
    message_source: 'local'
  }

}));

// const config = {
//   s3Bucket: 'gitc-jn-sips-mock',
//   folder: 'PDR'
// };

// const DiscoverPdr = module.exports;
// const discoverPdr = new DiscoverPdr(null, config, null, null);

// const demo = async () => {
//   while (true) {
//     log.info(await discoverPdr.run());
//     await sleep(10000);
//   }
// };

// demo();

