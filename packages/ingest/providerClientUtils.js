'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { randomString } = require('@cumulus/common/test-utils');
const FtpProviderClient = require('./FtpProviderClient');
const HttpProviderClient = require('./HttpProviderClient');
const S3ProviderClient = require('./S3ProviderClient');
const SftpProviderClient = require('./SftpProviderClient');

const buildProviderClient = (providerConfig = {}) => {
  switch (providerConfig.protocol) {
  case 'ftp':
    return new FtpProviderClient(providerConfig);
  case 'http':
  case 'https':
    return new HttpProviderClient(providerConfig);
  case 's3':
    return new S3ProviderClient({
      bucket: providerConfig.host,
      path: providerConfig.path
    });
  case 'sftp':
    return new SftpProviderClient(providerConfig);
  default:
    throw new Error(`Protocol ${providerConfig.protocol} is not supported.`);
  }
};

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
