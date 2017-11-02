'use strict';

const log = require('@cumulus/common/log');
const Task = require('@cumulus/common/task');
const aws = require('@cumulus/common/aws');
const promisify = require('util.promisify');
const FtpClient = require('ftp');
const SftpClient = require('sftpjs');
const pdrMod = require('./pdr');
const stringToStream = require('string-to-stream');

/**
 * Task that retrieves PDRs from a SIPS server
 * Input payload: none
 * Output payload: An array of objects with keys `pdr_file_name`, `s3_bucket`, and `s3_key`
 * representing the original file name and location in S3 of any newly downloaded PDRs
 */
module.exports = class DiscoverPdr extends Task {
  /**
   * Main task entry point
   * @return An object referencing the oldest PDR on the server
   */
  async run() {
    // Vars needed from config to connect to the SIPS server
    const { conn_type, host, port, username, password } =
     this.message.provider.config.gateway_config.conn_config;
    // The folder on the SIPS server holding the PDRS and the S3 bucket to which they should
    // be copied
    const { folder, bucket } = this.config;
    const keyPrefix = `${this.config.key_prefix}/pdr`;

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

    let returnValue;
    try {
      // Get the list of PDRs
      const pdrList = await pdrMod.getPdrList(client, folder, bucket, keyPrefix);

      const S3UploadPromises = pdrList.map(async pdrEntry => {
        const fileName = pdrEntry.name;
        log.info(`FILE: ${fileName}`);
         // Get the file contents
        const pdr = await pdrMod.getPdr(client, folder, fileName);
        log.debug('SUCCESSFULLY RETRIEVED PDR FROM SIPS SERVER');
        // Write the contents out to S3
        const s3PdrKey = `${keyPrefix}/${fileName}`;
        const pdrStream = stringToStream(pdr.pdr);
        await aws.uploadS3FileStream(pdrStream, bucket, s3PdrKey);
        log.debug(`PDR stored at [${s3PdrKey} in S3 bucket [${bucket}]`);

        return {
          pdr_file_name: fileName,
          s3_bucket: bucket,
          s3_key: s3PdrKey
        };
      });

      returnValue = await Promise.all(S3UploadPromises);
    }
    catch (e) {
      log.error('Failed to download file');
      log.error(e);
      throw e;
    }
    finally {
      // Close the connection to the SIPS server
      client.end();
    }

    return returnValue;
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
