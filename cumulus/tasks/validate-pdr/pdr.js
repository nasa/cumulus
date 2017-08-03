'use strict';

const log = require('cumulus-common/log');
const pvl = require('pvl');

const fileSpecFields =
  ['DIRECTORY_ID', 'FILE_ID', 'FILE_CKSUM_TYPE', 'FILE_CKSUM_VALUE', 'FILE_TYPE', 'FILE_SIZE'];

/**
 * Parses a PDR, performing validation and returning a list of file paths
 * @param {string} pdr The text of the PDR
 * @return {PVLRoot} An object representing a PDR
 * @throws {Error} Throws an Error if parsing fails
 */
exports.parsePdr = pdr => pvl.pvlToJS(pdr);

/**
 * Convert a PVL FILE_SPEC entry into an object with enough information to download the
 * associated file and verify it
 * @param {PVLObject} fileSpec An object containing the FILE_SPEC data
 * @return {Object} An object containing the FILE_SPEC data needed for downloading the archive file
 */
exports.fileSpecToFileEntry = (fileSpec, host, port, user, pass) => {
  const [directory, fileName, checksumType, checksum, fileType, size] =
    fileSpecFields.map((field) => fileSpec.get(field).value);
  return {
    type: 'download',
    source: {
      // TODO url encode this
      url: `ftp://${user}:${pass}@${host}:${port}${directory}/${fileName}.${fileType}`
    },
    target: 'FROM_CONFIG',
    checksumType: checksumType,
    checksum: checksum,
    size: size
  };
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
