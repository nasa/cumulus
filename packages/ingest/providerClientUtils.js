'use strict';

const FtpProviderClient = require('./FtpProviderClient');
const HttpProviderClient = require('./HttpProviderClient');
const S3ProviderClient = require('./S3ProviderClient');
const SftpProviderClient = require('./SftpProviderClient');

const buildProviderClient = (providerConfig = {}) => {
  switch (providerConfig.protocol) {
  case 'ftp':
    return new FtpProviderClient({
      host: providerConfig.host,
      port: providerConfig.port,
      username: providerConfig.username,
      password: providerConfig.password,
      encrypted: providerConfig.encrypted,
      userList: providerConfig.useList,
      path: providerConfig.path
    });
  case 'http':
  case 'https':
    return new HttpProviderClient({
      protocol: providerConfig.protocol,
      host: providerConfig.host,
      port: providerConfig.port,
      path: providerConfig.path
    });
  case 's3':
    return new S3ProviderClient({
      bucket: providerConfig.host,
      path: providerConfig.path
    });
  case 'sftp':
    return new SftpProviderClient({
      id: providerConfig.id,
      host: providerConfig.host,
      port: providerConfig.port,
      username: providerConfig.username,
      password: providerConfig.password,
      encrypted: providerConfig.encrypted,
      privateKey: providerConfig.privateKey,
      cmKeyId: providerConfig.cmKeyId,
      path: providerConfig.path
    });
  default:
    throw new Error(`Protocol ${providerConfig.protocol} is not supported.`);
  }
};

module.exports = { buildProviderClient };
