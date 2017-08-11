/**
 * Functions to interact with a SIPS server via s/ftp. These utilize a Client object that can
 * be ftp or sftp as long as it is compatible with the client API provided by the ftp npm
 * package.
 */

const log = require('cumulus-common/log');
const path = require('path');
const promisify = require('util.promisify');

/**
 * Delete a file from the SIPS server.
 * @param {Client} client The client connected to the SIPS server
 * @param {string} dir The directory where the file is located
 * @param {string} fileName The name of the file to be retrieved
 * @return A Promise that resolves to the path of the deleted file
 */
exports.deleteFile = (client, dir, fileName) => {
  const filePath = path.join(dir, fileName);
  log.info(`Removing file ${filePath}`);
  const syncDelete = promisify(client.delete).bind(client);
  return syncDelete(filePath);
};

