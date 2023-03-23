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

const buildUploaderClient = (providerConfig = {}) => {
    switch (providerConfig.protocol) {
        case 'ftp':
            FtpProviderClient.prototype.upload = ftp_uploader
            uploader_client = new FtpProviderClient(providerConfig);
            return uploader_client
        case 'http':
        case 'https':
            HttpProviderClient.prototype.upload = http_uploader
            return new HttpProviderClient(providerConfig);
        case 's3':
            S3ProviderClient.prototype.upload = s3_uploader
            return new S3ProviderClient({ bucket: providerConfig.host });
        case 'sftp':
            SftpProviderClient.prototype.upload = sftp_uploader
            return new SftpProviderClient(providerConfig);
        default:
            throw new Error(`Protocol ${providerConfig.protocol} is not supported.`);
    }
};

async function ftp_uploader() {
    return {}
}

async function http_uploader(params) {
    const { localPath, uploadPath } = params;
    await this.setUpGotOptions();
    await this.downloadTLSCertificate();
    const options = {
        protocol: 'http',
        host: this.host,
        port: this.port,
        path: uploadPath,
        method: 'POST',
    }
    log.info(params)
    let remoteUrl = buildURL(options);
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


async function s3_uploader(params) {
    return {}
}

async function sftp_uploader(params) {
    return {}
}

module.exports = {
    buildUploaderClient
};