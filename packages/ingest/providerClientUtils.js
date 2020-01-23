'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { randomString } = require('@cumulus/common/test-utils');
const FtpProviderClient = require('./FtpProviderClient');
const HttpProviderClient = require('./HttpProviderClient');
const S3ProviderClient = require('./S3ProviderClient');
const SftpProviderClient = require('./SftpProviderClient');

/**
 * Create a provider client appropriate for the provider config
 *
 * @param {Object} providerConfig - a provider config object
 * @returns {Object} a ProviderClient
 */
const buildProviderClient = (providerConfig = {}) => {
  switch (providerConfig.protocol) {
  case 'ftp':
    return new FtpProviderClient(providerConfig);
  case 'http':
  case 'https':
    return new HttpProviderClient(providerConfig);
  case 's3':
    return new S3ProviderClient({ bucket: providerConfig.host });
  case 'sftp':
    return new SftpProviderClient(providerConfig);
  default:
    throw new Error(`Protocol ${providerConfig.protocol} is not supported.`);
  }
};

/**
 * Fetch a file from a provider and return it as a string
 *
 * @param {Object} providerClient - a provider client
 * @param {string} remotePath - the path of the file to fetch
 * @returns {string} the contents of the remote file
 */
const fetchTextFile = async (providerClient, remotePath) => {
  const localPath = path.join(os.tmpdir(), randomString());
  try {
    await providerClient.download(remotePath, localPath);
    return await fs.readFile(localPath, 'utf8');
  } finally {
    await fs.unlink(localPath);
  }
};

module.exports = {
  buildProviderClient,
  fetchTextFile
};
