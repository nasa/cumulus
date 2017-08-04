'use strict';

const aws = require('cumulus-common/aws');
const path = require('path');
const fs = require('fs');
const promisify = require('util.promisify');
const thenable = require('thenable-stream');

/**
 * Get the list of PDRs using the given client (ftp/sftp)
 * @param {Client} client The client connected to the SIPS server
 * @param {string} folder The directory on the server containing the PDRs
 * @return A promise that resolves to a list of strings containing the file names of the PDRs
 */
exports.getPdrList = async (client, folder) => {
  const listSync = promisify(client.list).bind(client);
  return await listSync(folder);
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
  return { pdrFileName: fileName, pdr: pdr.toString() };
};
