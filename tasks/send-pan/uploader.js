const FtpProviderClient = require('@cumulus/ingest/FtpProviderClient');
const HttpProviderClient = require('@cumulus/ingest/HttpProviderClient');
const S3ProviderClient = require('@cumulus/ingest/S3ProviderClient');
const SftpProviderClient = require('@cumulus/ingest/SftpProviderClient');
const log = require('@cumulus/common/log');
const { buildURL } = require('@cumulus/common/URLUtils');
const { promisify } = require('util');
const { pipeline } = require('stream');
const stream = require('node:stream');
const got = require('got');
const fs = require('fs');

/**
 * Upload PAN file via FTP
 */
async function ftpUploader() {
//  return {};
}

/**
 * Upload PAN via HTTP or HTTPS
 *
 * @param {object} params - provider configuration
 */
async function httpUploader(params) {
  const { localPath, uploadPath } = params;
  await this.setUpGotOptions();
  await this.downloadTLSCertificate();
  const options = {
    protocol: 'http',
    host: this.host,
    port: this.port,
    path: uploadPath,
    method: 'POST',
  };

  log.info(params);

  const remoteUrl = buildURL(options);
  log.info(`Uploading ${localPath} to ${remoteUrl}`);
  got.stream.options = options;
  await promisify(pipeline)(
    fs.createReadStream(localPath),
    await got.stream.post(remoteUrl),
    new stream.PassThrough()
  );

  log.info(`Finishing uploading ${localPath} to ${remoteUrl}`);

  return localPath;
}

/**
 * Upload PAN via S3
 *
 * @param {object} _params - provider bucket
 */
async function s3Uploader(_params) {
//  return {};
}

/**
 * Upload PAN via SFTP
 *
 * @param {object} _params - provider configuration
 */
async function sftpUploader(_params) {
//  return {};
}

const buildUploaderClient = (providerConfig = {}) => {
  switch (providerConfig.protocol) {
  case 'ftp': {
    FtpProviderClient.prototype.upload = ftpUploader;
    const uploaderClient = new FtpProviderClient(providerConfig);
    return uploaderClient;
  }
  case 'http':
  case 'https':
    HttpProviderClient.prototype.upload = httpUploader;
    return new HttpProviderClient(providerConfig);
  case 's3':
    S3ProviderClient.prototype.upload = s3Uploader;
    return new S3ProviderClient({ bucket: providerConfig.host });
  case 'sftp':
    SftpProviderClient.prototype.upload = sftpUploader;
    return new SftpProviderClient(providerConfig);
  default:
    throw new Error(`Protocol ${providerConfig.protocol} is not supported.`);
  }
};
module.exports = {
  buildUploaderClient,
};
