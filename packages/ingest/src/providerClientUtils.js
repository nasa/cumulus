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
 * @param {Object} param
 * @param {Object} param.providerClient  - a provider client
 * @param {string} param.remotePath      - the path of the file to fetch
 * @param {string} [param.remoteAltBucket] - alternate per-file bucket override to
 * the providerClient
 * bucket
 * @returns {Promise<string>} the contents of the remote file
 */
const fetchTextFile = async ({ providerClient, remotePath, remoteAltBucket }) => {
  const localPath = path.join(os.tmpdir(), randomString());
  try {
    await providerClient.download({ remotePath, localPath, remoteAltBucket });
    return await fs.readFile(localPath, 'utf8');
  } finally {
    // eslint-disable-next-line lodash/prefer-noop
    await fs.unlink(localPath).catch(() => {});
  }
};

module.exports = {
  buildProviderClient,
  fetchTextFile,
};
