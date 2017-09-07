/**
 * Functions to interact with a SIPS server via s/ftp. These utilize a Client object that can
 * be ftp or sftp as long as it is compatible with the client API provided by the ftp npm
 * package.
 */

const log = require('@cumulus/common/log');
const path = require('path');
const promisify = require('util.promisify');

 /**
 *  Upload a file to a SIPS server.
 * @param {Client} client The client connected to the SIPS server
 * @param {string} destinationDir The directory in which to put the file.
 * @param {string} file The contents of the file.
 * @return A Promise that resolves to the status of the put operation.
 */
exports.uploadFile = async (client, destinationDir, fileName, fileDataStream) => {
  log.info(`Uploading ${fileName} to ${destinationDir}`);
  const destinationPath = path.join(destinationDir, fileName);
  const syncPut = promisify(client.put).bind(client);
  return syncPut(fileDataStream, destinationPath);
};

