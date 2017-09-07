/**
 * Functions to interact with a SIPS server via s/ftp. These utilize a Client object that can
 * be ftp or sftp as long as it is compatible with the client API provided by the ftp npm
 * package.
 */

const log = require('@cumulus/common/log');
const fs = require('fs');
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

/**
 * Download a file from a SIPS server.
 * @param {Client} client The client connected to the SIPS server
 * @param {string} dir The directory where the file is located
 * @param {string} destinationDir The local directory where the file will be stored
 * @param {string} fileName The name of the file to be retrieved
 * @return A Promise that resolves to the path of the saved file
 */
exports.downloadFile = async (client, dir, destinationDir, fileName) => {
  log.info(`Downloading ${dir}/${fileName}`);
  const syncGet = promisify(client.get).bind(client);
  const stream = await syncGet(`${dir}/${fileName}`);
  const outputPath = path.join(destinationDir, fileName);
  const outputStream = fs.createWriteStream(outputPath);
  stream.pipe(outputStream);
  // We have to use a Promise here because we need to force a wait until the input stream has
  // finished providing data. The only other alternative would be to read the input stream
  // ourselves instead of piping to the file writer, but that would mean we would have to hold
  // the (possibly large) archive file in memory.
  return new Promise((resolve) => {
    stream.once('end', () => resolve(outputPath));
  });
};

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

