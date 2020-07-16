'use strict';

const http = require('@cumulus/common/http');
const https = require('https');
const isIp = require('is-ip');
const { basename } = require('path');
const { PassThrough } = require('stream');
const Crawler = require('simplecrawler');
const got = require('got');
const { CookieJar } = require('tough-cookie');

const {
  buildS3Uri,
  getTextObject,
  parseS3Uri,
  promiseS3Upload
} = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');
const isValidHostname = require('is-valid-hostname');
const { buildURL } = require('@cumulus/common/URLUtils');
const errors = require('@cumulus/errors');

const { lookupMimeType, decrypt } = require('./util');
const {
  emptyProviderConnectEndMixin
} = require('./emptyProviderConnectEndMixin');

const validateHost = (host) => {
  if (isValidHostname(host) || isIp(host)) return;

  throw new TypeError(`provider.host is not a valid hostname or IP: ${host}`);
};

class HttpProviderClient {
  constructor(providerConfig) {
    this.providerConfig = providerConfig;
    this.protocol = providerConfig.protocol;
    this.host = providerConfig.host;
    this.port = providerConfig.port;
    this.httpListTimeout = providerConfig.httpListTimeout;
    this.gotOptions = {};
    this.certificateUri = providerConfig.certificateUri;
    if (providerConfig.username && !providerConfig.password) {
      throw new ReferenceError('Found providerConfig.username, but providerConfig.password is not defined');
    }
    this.encrypted = providerConfig.encrypted;
    this.endpoint = buildURL({
      protocol: this.protocol,
      host: this.host,
      port: this.port
    });
  }

  async setUpGotOptions() {
    if (this.encrypted === true) {
      this.username = await decrypt(this.providerConfig.username);
      this.password = await decrypt(this.providerConfig.password);
    } else {
      this.username = this.providerConfig.username;
      this.password = this.providerConfig.password;
    }
    const cookieJar = new CookieJar();
    const auth = `${this.username}:${this.password}`;
    this.gotOptions = {
      ...this.gotOptions,
      auth,
      cookieJar
    };
  }

  async downloadTLSCertificate() {
    if (!this.certificateUri || this.certificate !== undefined) return;
    try {
      const s3Params = parseS3Uri(this.certificateUri);
      this.certificate = await getTextObject(s3Params.Bucket, s3Params.Key);
      this.gotOptions.ca = this.certificate;
    } catch (error) {
      throw new errors.RemoteResourceError(`Failed to fetch CA certificate: ${error}`);
    }
  }

  /**
   * List all PDR files from a given endpoint
   *
   * @param {string} path - the remote path to list
   * @returns {Promise<Array>} a list of files
   */
  async list(path) {
    validateHost(this.host);
    await this.downloadTLSCertificate();

    // Make pattern case-insensitive and return all matches
    // instead of just first one
    const matchLinksPattern = /<a href="([^>]*)">[^<]+<\/a>/gi;
    const matchLeadingSlashesPattern = /^\/+/;

    const c = new Crawler(
      buildURL({
        protocol: this.protocol,
        host: this.host,
        port: this.port,
        path
      })
    );

    if (this.protocol === 'https' && this.certificate !== undefined) {
      c.httpsAgent = new https.Agent({ ca: this.certificate });
    }
    if (this.httpListTimeout) {
      c.timeout = this.httpListTimeout * 1000;
    }
    c.interval = 0;
    c.maxConcurrency = 10;
    c.respectRobotsTxt = false;
    c.userAgent = 'Cumulus';
    c.maxDepth = 1;
    const files = [];

    return new Promise((resolve, reject) => {
      c.on('fetchcomplete', (_, responseBuffer) => {
        const lines = responseBuffer.toString().trim().split('\n');
        lines.forEach((line) => {
          const trimmedLine = line.trim();
          let match = matchLinksPattern.exec(trimmedLine);

          while (match !== null) {
            const linkTarget = match[1];
            // Remove the path and leading slashes from the filename.
            const name = linkTarget
              .replace(path, '')
              .replace(matchLeadingSlashesPattern, '')
              .trimRight();
            files.push({ name, path });
            match = matchLinksPattern.exec(trimmedLine);
          }
        });

        return resolve(files);
      });

      c.on('fetchtimeout', () =>
        reject(new errors.RemoteResourceError('Connection timed out')));

      c.on('fetcherror', (queueItem, response) => {
        let responseBody = '';
        response.on('data', (chunk) => {
          responseBody += chunk;
        });

        response.on('end', () => {
          const err = new errors.RemoteResourceError(
            `"${response.req.method} ${queueItem.url}" failed with status code ${response.statusCode}`
          );
          err.details = responseBody;
          return reject(err);
        });
      });

      c.on('fetchclienterror', (_, errorData) =>
        reject(new errors.RemoteResourceError(`Connection Error: ${JSON.stringify(errorData)}`)));

      c.on('fetch404', (queueItem, _) => {
        const errorToThrow = new Error(`Received a 404 error from ${this.endpoint}. Check your endpoint!`);
        errorToThrow.details = queueItem;
        return reject(errorToThrow);
      });

      c.start();
    });
  }

  /**
   * Download a remote file to disk
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} localPath - the full local destination file path
   * @returns {Promise.<string>} - the path that the file was saved to
   */
  async download(remotePath, localPath) {
    validateHost(this.host);
    await this.setUpGotOptions();
    await this.downloadTLSCertificate();

    const remoteUrl = buildURL({
      protocol: this.protocol,
      host: this.host,
      port: this.port,
      path: remotePath
    });

    log.info(`Downloading ${remoteUrl} to ${localPath}`);
    try {
      await http.download(remoteUrl, localPath, this.gotOptions);
    } catch (error) {
      if (error.message && error.message.includes('Unexpected HTTP status code: 403')) {
        const message = `${basename(remotePath)} was not found on the server with 403 status`;
        throw new errors.FileNotFound(message);
      } else throw error;
    }
    log.info(`Finishing downloading ${remoteUrl}`);

    return localPath;
  }

  /**
   * Download the remote file to a given s3 location
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} bucket - destination s3 bucket of the file
   * @param {string} key - destination s3 key of the file
   * @returns {Promise.<{ s3uri: string, etag: string }>} an object containing
   *    the S3 URI and ETag of the destination file
   */
  async sync(remotePath, bucket, key) {
    validateHost(this.host);
    await this.setUpGotOptions();
    await this.downloadTLSCertificate();
    const remoteUrl = buildURL({
      protocol: this.protocol,
      host: this.host,
      port: this.port,
      path: remotePath
    });

    const s3uri = buildS3Uri(bucket, key);
    log.info(`Sync ${remoteUrl} to ${s3uri}`);

    let headers = {};
    try {
      const headResponse = await got.head(remoteUrl, this.gotOptions);
      headers = headResponse.headers;
    } catch (error) {
      log.info(`HEAD failed for ${remoteUrl} with error: ${error}.`);
    }
    const contentType = headers['content-type'] || lookupMimeType(key);

    const pass = new PassThrough();
    got.stream(remoteUrl, this.gotOptions).pipe(pass);
    const { ETag: etag } = await promiseS3Upload({
      Bucket: bucket,
      Key: key,
      Body: pass,
      ContentType: contentType
    });

    log.info('Uploading to s3 is complete (http)', s3uri);
    return { s3uri, etag };
  }
}

Object.assign(
  HttpProviderClient.prototype,
  emptyProviderConnectEndMixin
);

module.exports = HttpProviderClient;
