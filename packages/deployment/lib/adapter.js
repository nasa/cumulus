'use strict';

const fs = require('fs-extra');
const http = require('@cumulus/common/http');
const got = require('got');
const extract = require('extract-zip');

/**
 * `downloadZipfile` downloads zip file from remote location and stores on disk
 *
 * @param {string} fileUrl - URL file location
 * @param {string} localFilename - Where to store file locally
 * @returns {Promise} resolves when the download is completed
 */
function downloadZipfile(fileUrl, localFilename) {
  return http.download(
    fileUrl,
    localFilename,
    {
      headers: {
        Accept: 'application/octet-stream',
        'Content-Type': 'application/zip',
        'Content-Transfer-Encoding': 'binary'
      }
    }
  );
}

/**
 * unzip a given zip file to the given destination
 *
 * @param {string} filename - the zip file to extract
 * @param {string} dst - the destination to extract the file
 * @returns {Promise.<string>} the path of the extracted zip
 */
function extractZipFile(filename, dst) {
  // create the destination folder it doesn't exist
  fs.mkdirpSync(dst);
  return new Promise((resolve, reject) => {
    extract(filename, { dir: dst }, (err) => {
      if (err) return reject(err);
      console.log(`${filename} extracted to ${dst}`);
      return resolve(dst);
    });
  });
}

/**
 * Fetches the latest release version of the cumulus message adapter
 *
 * @param {string} gitPath - path to the cumulus message adapter repo
 * @returns {Promise.<string>} Promise resolution is string of latest github release, e.g. 'v0.0.1'
 */
async function fetchLatestMessageAdapterRelease(gitPath) {
  const url = process.env.GITHUB_TOKEN
    ? `https://api.github.com/repos/${gitPath}/releases/latest?access_token=${process.env.GITHUB_TOKEN}`
    : `https://api.github.com/repos/${gitPath}/releases/latest`;

  const response = await got(
    url,
    {
      json: true,
      headers: {
        'User-Agent': '@cumulus/deployment' // Required by Github API
      }
    }
  );

  return response.body.tag_name;
}

/**
 * Determine the version of the cumulus-message-adapter to use
 *
 * @param {string} version - the cumulus-message-adapter version (default to null)
 * @param {string} gitPath - path to the cumulus message adapter repo
 * @returns {Promise.<string>} - the message adapter version
 */
function messageAdapterVersion(version, gitPath) {
  if (version) {
    return Promise.resolve(version);
  }
  return fetchLatestMessageAdapterRelease(gitPath);
}

/**
 * The Github URL of the cumulus-message-adapter zip file
 *
 * @param {string} version - the cumulus-message-adapter version (default to null)
 * @param {string} gitPath - path to the cumulus message adapter repo
 * @param {string} filename - the zip file to extract
 * @returns {Promise.<string>} - the URL to fetch the cumulus-message-adapter from
 */
function messageAdapterUrl(version, gitPath, filename) {
  return messageAdapterVersion(version, gitPath)
    .then((ver) => (process.env.GITHUB_TOKEN
      ? `https://github.com/${gitPath}/releases/download/${ver}/${filename}?access_token=${process.env.GITHUB_TOKEN}`
      : `https://github.com/${gitPath}/releases/download/${ver}/${filename}`));
}

/**
 * Determines which release version should be downloaded from
 * cumulus-message-adapter repository and then downloads that file.
 *
 * @param {string} version - the cumulus-message-adapter version (default to null)
 * @param {string} gitPath - path to the cumulus message adapter repo
 * @param {string} filename - the zip file to extract
 * @param {string} src - the path to where the zip file should be downloaded to
 * @param {string} dest - the path to where the zip file should be extracted to
 * @returns {Promise} returns the path of the extracted message adapter or an empty response
 */
function fetchMessageAdapter(version, gitPath, filename, src, dest) {
  return messageAdapterUrl(version, gitPath, filename)
    .then((url) => downloadZipfile(url, src))
    .then(() => extractZipFile(src, dest));
}

module.exports = {
  downloadZipfile,
  extractZipFile,
  fetchLatestMessageAdapterRelease,
  messageAdapterVersion,
  messageAdapterUrl,
  fetchMessageAdapter
};
