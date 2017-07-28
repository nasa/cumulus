'use strict';

const log = require('cumulus-common/log');
const pvl = require('pvl');

/**
 * Parses a PDR, performing validation and returning a list of file paths
 * @param {string} pdr The text of the PDR
 * @return {PVLRoot} An object representing a PDR
 * @throws {Error} Throws an Error if parsing fails
 */
exports.parsePdr = pdr => pvl.pvlToJS(pdr);


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
