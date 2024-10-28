'use strict';

const fs = require('fs');
const https = require('https');
const isIp = require('is-ip');
const { basename } = require('path');
const { pipeline } = require('stream/promises');
const { PassThrough } = require('stream');
const Crawler = require('simplecrawler');
const { CookieJar } = require('tough-cookie');
const { importGot } = require('@cumulus/common/importEsm');

const {
  buildS3Uri,
  getTextObject,
  parseS3Uri,
  streamS3Upload,
} = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');
const isValidHostname = require('is-valid-hostname');
const { buildURL } = require('@cumulus/common/URLUtils');
const errors = require('@cumulus/errors');

const { lookupMimeType, decrypt } = require('./util');

const validateHost = (host) => {
  if (isValidHostname(host) || isIp(host)) return;

  throw new TypeError(`provider.host is not a valid hostname or IP: ${host}`);
};

const redirectCodes = new Set([300, 301, 302, 303, 304, 307, 308]);

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

    this.defaultRedirect = this.port ? `${this.host}:${this.port}` : this.host;
    this.allowedRedirects = this.providerConfig.allowedRedirects || [];
    this.allowedRedirects.push(this.defaultRedirect);

    this.endpoint = buildURL({
      protocol: this.protocol,
      host: this.host,
      port: this.port,
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

    this.gotOptions.cookieJar = new CookieJar();

    if (this.username) this.gotOptions.username = this.username;
    if (this.password) this.gotOptions.password = this.password;

    const RedirectHandler = {
      // Need to use named function and not fat arrow
      // expression so that we can use the bound value
      // of "this"
      handleBeforeRedirect(options, response) {
        if (!this.allowedRedirects.includes(options.url.host)) {
          log.debug(`
            ${options.url.host} does match any of the allowed redirects
            in ${JSON.stringify(this.allowedRedirects)}, so auth credentials
            will not be forwarded. If provider specifies a port number, ensure
            that allowed redirect specifies the port number.
          `);
          return;
        }

        if (redirectCodes.has(response.statusCode)) {
          /* eslint-disable no-param-reassign */
          options.url.username = this.username;
          options.url.password = this.password;
          /* eslint-enable no-param-reassign */
        }
      },
    };
    const boundHandleBeforeRedirect = RedirectHandler.handleBeforeRedirect.bind(this);
    this.gotOptions.hooks = {
      beforeRedirect: [
        boundHandleBeforeRedirect,
      ],
    };
  }

  async downloadTLSCertificate() {
    if (!this.certificateUri || this.certificate !== undefined) return;
    try {
      const s3Params = parseS3Uri(this.certificateUri);
      this.certificate = await getTextObject(s3Params.Bucket, s3Params.Key);
      this.gotOptions.https = this.gotOptions.https || {};
      this.gotOptions.https.certificateAuthority = this.certificate;
    } catch (error) {
      throw new errors.RemoteResourceError(`Failed to fetch CA certificate: ${error}`);
    }
  }

  /**
   * List all PDR files from a given endpoint
   *
   * @param {string} path - the remote path to list
   * @param {testMocks} - Mocks for testing
   * @returns {Promise<Array>} a list of files
   */
  async list(path, testMocks = {}) {
    validateHost(this.host);
    await this.downloadTLSCertificate();

    // Make pattern case-insensitive and return all matches
    // instead of just first one
    const matchLinksPattern = /<a href="([^>]*)">[^<]+<\/a>/gi;
    const matchLeadingSlashesPattern = /^\/+/;

    const listCrawler = testMocks.crawler ? testMocks.crawler : new Crawler(
      buildURL({
        protocol: this.protocol,
        host: this.host,
        port: this.port,
        path,
      })
    );

    if (this.protocol === 'https' && this.certificate !== undefined) {
      listCrawler.httpsAgent = new https.Agent({ ca: this.certificate });
    }
    if (this.httpListTimeout) {
      listCrawler.timeout = this.httpListTimeout * 1000;
    }
    listCrawler.interval = 0;
    listCrawler.maxConcurrency = 10;
    listCrawler.respectRobotsTxt = false;
    listCrawler.userAgent = 'Cumulus';
    listCrawler.maxDepth = 1;
    const files = [];

    return new Promise((resolve, reject) => {
      listCrawler.on('fetchcomplete', (_, responseBuffer) => {
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

      listCrawler.on('fetchtimeout', () =>
        reject(new errors.RemoteResourceError('Connection timed out')));

      listCrawler.on('fetcherror', (queueItem, response) => {
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

      listCrawler.on('fetchclienterror', (_, errorData) =>
        reject(new errors.RemoteResourceError(`Connection Error: ${JSON.stringify(errorData)}`)));

      listCrawler.on('fetch404', (queueItem, _) => {
        const errorToThrow = new Error(`Received a 404 error from ${this.endpoint}. Check your endpoint!`);
        errorToThrow.details = queueItem;
        return reject(errorToThrow);
      });

      listCrawler.start();
    });
  }

  /**
   * Download a remote file to disk
   *
   * @param {object} params
   * @param {string} params.remotePath - the full path to the remote file to be fetched
   * @param {string} params.localPath - the full local destination file path
   * @returns {Promise.<string>} - the path that the file was saved to
   */
  async download(params) {
    const got = await importGot();

    const { remotePath, localPath } = params;
    validateHost(this.host);
    await this.setUpGotOptions();
    await this.downloadTLSCertificate();

    const remoteUrl = buildURL({
      protocol: this.protocol,
      host: this.host,
      port: this.port,
      path: remotePath,
    });

    log.info(`Downloading ${remoteUrl} to ${localPath}`);
    try {
      await pipeline(
        got.stream(remoteUrl, this.gotOptions),
        fs.createWriteStream(localPath)
      );
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
   * @param {object} params
   * @param {string} params.fileRemotePath - the full path to the remote file to be fetched
   * @param {string} params.destinationBucket - destination s3 bucket of the file
   * @param {string} params.destinationKey - destination s3 key of the file
   * @returns {Promise.<{ s3uri: string, etag: string }>} an object containing
   *    the S3 URI and ETag of the destination file
   */
  async sync(params) {
    const got = await importGot();

    const { destinationBucket, destinationKey, fileRemotePath } = params;
    validateHost(this.host);
    await this.setUpGotOptions();
    await this.downloadTLSCertificate();
    const remoteUrl = buildURL({
      protocol: this.protocol,
      host: this.host,
      port: this.port,
      path: fileRemotePath,
    });

    const s3uri = buildS3Uri(destinationBucket, destinationKey);
    log.info(`Sync ${remoteUrl} to ${s3uri}`);

    let headers = {};
    try {
      const headResponse = await got.head(remoteUrl, this.gotOptions);
      headers = headResponse.headers;
    } catch (error) {
      log.info(`HEAD failed for ${remoteUrl} with error: ${error}.`);
    }
    const contentType = headers['content-type'] || lookupMimeType(destinationKey);

    const uploadStream = got.stream(remoteUrl, this.gotOptions);
    const { ETag: etag } = await streamS3Upload(
      uploadStream,
      {
        params: {
          Bucket: destinationBucket,
          Key: destinationKey,
          ContentType: contentType,
        },
      }
    );

    log.info('Uploading to s3 is complete (http)', s3uri);
    return { s3uri, etag };
  }

  /**
   * Upload a file
   *
   * @param {object} params
   * @param {string} params.localPath - the full local file path
   * @param {string} params.uploadPath - the full remote file path for uploading file to
   * @returns {Promise<string>} the uri of the uploaded file
   */
  async upload(params) {
    const got = await importGot();
    const { localPath, uploadPath } = params;
    log.info({ localPath, uploadPath });
    await this.setUpGotOptions();
    await this.downloadTLSCertificate();
    const options = {
      protocol: this.protocol,
      host: this.host,
      port: this.port,
      path: uploadPath,
      method: 'POST',
    };

    const remoteUrl = buildURL(options);
    got.stream.options = options;
    await pipeline(
      fs.createReadStream(localPath),
      got.stream.post(remoteUrl),
      new PassThrough()
    );

    log.info(`Finishing uploading ${localPath} to ${remoteUrl}`);
    return remoteUrl;
  }

  /* eslint-disable no-empty-function */
  async connect() {}

  async end() {}
  /* eslint-enable no-empty-function */
}

module.exports = HttpProviderClient;
