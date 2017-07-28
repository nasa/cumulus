'use strict';

const log = require('cumulus-common/log');
const aws = require('cumulus-common/aws');
const Task = require('cumulus-common/task');
const promisify = require('util.promisify');
const FtpClient = require('ftp');
const SftpClient = require('sftpjs');
const pdrMod = require('./pdr');

/**
 * Task that retrieves PDRs from a SIPS server
 * Input payload: none
 * Output payload: A single object with keys `fileName` and `pdr` referencing the oldest PDR
 * on the SIPS server
 */
module.exports = class DiscoverPdr extends Task {
  /**
   * Main task entry point
   * @return An object referencing the oldest PDR on the server
   */
  async run() {
    // Vars needed from config to connect to the SIPS server (just an S3 bucket for now)
    const { protocol, host, port, user, password } = this.config;

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
    let fileName;
    let pdr;
    try {
      // Get the list of PDRs
      const list = await pdrMod.getPdrList(client);
      log.info(`PDR LIST: [${list}]`);
      // Get the oldest one
      fileName = list.sort((a, b) => b.date < a.date)[0].name;
      log.info('FILE:');
      log.info(fileName);
      // Get the file contents
      pdr = await pdrMod.getPdr(client, fileName);
      log.info('PDR:');
      log.info(pdr);
    }
    finally {
      // Close the connection to the SIPS server
      client.end();
    }

    // Set up callback to start our processing once the connection is 'ready' then connect
    // TODO - It's not clear to me what happens when an exception is thrown inside an event
    // handler. I need to establish how to correctly handle errors here.
    // client
    //   .once('ready', async () => {
    //     try {
    //       // Get the list of PDRs
    //       const list = await pdrMod.getPdrList(client);
    //       log.info(`PDR LIST: [${list}]`);
    //       // Get the oldest one
    //       const oldestPdr = list.sort((a, b) => b.date < a.date)[0];

    //     }
    //     finally {
    //       // Close the connection to the SIPS server
    //       client.end();
    //     }
    //   })
    //   .connect({
    //     host: host,
    //     port: port,
    //     user: user,
    //     password: password
    //   });

    // const { s3Bucket, folder } = this.config;

    // // Get the list of PDRs
    // const pdrList = await aws.listS3Objects(s3Bucket, `${folder}/`);

    // // Get the oldest PDR
    // const pdrInfo = pdrList.sort((obj1, obj2) => {
    //   const lastModStr1 = obj1.LastModified;
    //   const lastModStr2 = obj2.LastModified;
    //   const lastMod1 = new Date(lastModStr1);
    //   const lastMod2 = new Date(lastModStr2);

    //   return lastMod1 < lastMod2;
    // })[0];

    // const s3Key = pdrInfo.Key;
    // const { fileName, pdr } = await pdrMod.getPdr(s3Bucket, s3Key);

    return {
      fileName: fileName,
      pdr: pdr
    };
  }

  /**
   * Entry point for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return DiscoverPdr.handle(...args);
  }
};

// Test code

// const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    task: 'DiscoverPdr',
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

