'use strict';

const aws = require('cumulus-common/aws');
const log = require('cumulus-common/log');
const pvl = require('pvl');
// const promisify = require('util.promisify');
// const stp = require('stream-to-promise');
const sts = require('string-to-stream');
const path = require('path');
const fs = require('fs');

/**
   * Get the contents of a PDR from a SIPS server (S3 bucket for now)
   * @param {string} s3Bucket The bucket from which to read the file
   * @param {string} s3Key The key for the file object
   * @return An object with keys `fileName` and `pdr`.
   */
exports.getPdr = async (s3Bucket, s3Key) => {
  await aws.downloadS3Files([{ Bucket: s3Bucket, Key: s3Key }], '/tmp');
  const fileName = path.basename(s3Key);
  const filePath = path.join('/tmp', fileName);
  const pdr = fs.readFileSync(filePath, 'utf8');
  // const streamPromise = stp(stream);
  // const pdr = await streamPromise;
  return { fileName: fileName, pdr: pdr.toString() };
};

/**
 * Parses a PDR, performing validation and returning a list of file paths
 * @param {string} pdr The text of the PDR
 * @return {PVLRoot} An object representing a PDR
 * @throws {Error} Throws an Error if parsing fails
 */
exports.parsePdr = pdr => pvl.pvlToJS(pdr);

/**
 * Validate the file entries in a PDR
 * @param {PVLRoot} pdrObj An object representing a PDR
 * @return {Array} A list of 'dispositions', one for each file referenced in the PDR. A disposition
 * is a string indicating the success or failure in validating the file group entry.
 * of errors for the respective file group.
 */
exports.validatePdr = pdrObj => {
  const fileGroups = pdrObj.objects('FILE_GROUP');

};

// test code
/*
const Client = require('ftp');
const pdr = exports;
const client = new Client();

const host = 'localhost';
const port = 21;
const user = 'ftp';
const password = 'ftp';

// Set up callback to start our processing once the connection is 'ready' then connect
client
  .on('ready', async () => {
    try {
      // get the list of PDRs
      const list = (await pdr.getPdrList(client)).map(entry => entry.name);
      log.info(list);

      await pdr.processPdrs(client, list, '/tmp/downloads');
    }
    finally {
      // Close the connection
      client.end();
    }
  })
  .connect({
    host: host,
    port: port,
    user: user,
    password: password
  });
*/
