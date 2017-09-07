'use strict';

const promisify = require('util.promisify');
const thenable = require('thenable-stream');
const { S3 } = require('@cumulus/ingest/aws');

/**
 * Get the list of new PDRs using the given client (ftp/sftp)
 * @param {Client} client The client connected to the SIPS server
 * @param {string} folder The directory on the server containing the PDRs
 * @param {string} bucket The S3 bucket that will hold the downloaded PDRs
 * @param {string} keyPrefix Prefix for the S3 key to use when looking for PDRs by name
 * @return A promise that resolves to a list of strings containing the file names of the PDRs
 */
exports.getPdrList = async (client, folder, bucket, keyPrefix) => {
  const listSync = promisify(client.list).bind(client);
  const pdrs = await listSync(folder);

  // Check to see which files we already have in S3
  const fileExistsPromises = pdrs.map(async pdr => {
    const fileName = pdr.name;
    return S3.fileExists(bucket, `${keyPrefix}/${fileName}`);
  });

  const fileExists = await Promise.all(fileExistsPromises);

  return pdrs.filter((_, index) => !fileExists[index]);
};

/**
 * Get the contents of a PDR from a SIPS server
 * @param {Client} client The client connected to the SIPS server
 * @param {string} folder The directory on the server containing the PDR
 * @param {string} fileName The name of the PDR to retrieve
 * @return An object with keys `fileName` and `pdr`.
 */
exports.getPdr = async (client, folder, fileName) => {
  const syncGet = promisify(client.get).bind(client);
  const stream = await syncGet(`${folder}/${fileName}`);
  stream.setEncoding('utf8');
  const streamPromise = thenable(stream);
  const pdr = await streamPromise;
  return { pdr_file_name: fileName, pdr: pdr.toString() };
};
