'use strict';

const http = require('@cumulus/common/http');
const isIp = require('is-ip');
const { basename } = require('path');
const { PassThrough } = require('stream');
const Crawler = require('simplecrawler');
const got = require('got');

const { buildS3Uri, promiseS3Upload } = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');
const { isValidHostname } = require('@cumulus/common/string');
const { buildURL } = require('@cumulus/common/URLUtils');
const errors = require('@cumulus/errors');
const { lookupMimeType } = require('./util');

const validateHost = (host) => {
  if (isValidHostname(host) || isIp(host)) return;

  throw new TypeError(`provider.host is not a valid hostname or IP: ${host}`);
};

class HttpProviderClient {
  constructor(providerConfig) {
    this.protocol = providerConfig.protocol;
    this.host = providerConfig.host;
    this.port = providerConfig.port;

    this.endpoint = buildURL({
      protocol: this.protocol,
      host: this.host,
      port: this.port
    });
  }

  /**
   * List all PDR files from a given endpoint
   *
   * @param {string} path - the remote path to list
   * @returns {Promise<Array>} a list of files
   */
  list(path) {
    validateHost(this.host);

    // Make pattern case-insensitive and return all matches
    // instead of just first one
    const matchLinksPattern = /<a href="([^>]*)">[^<]+<\/a>/ig;
    const matchLeadingSlashesPattern = /^\/+/;

    const c = new Crawler(
      buildURL({
        protocol: this.protocol,
        host: this.host,
        port: this.port,
        path
      })
    );

    c.timeout = 2000;
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

          while (match != null) {
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

      c.on('fetchclienterror', () =>
        reject(new errors.RemoteResourceError('Connection Refused')));

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

    const remoteUrl = buildURL({
      protocol: this.protocol,
      host: this.host,
      port: this.port,
      path: remotePath
    });

    log.info(`Downloading ${remoteUrl} to ${localPath}`);
    try {
      await http.download(remoteUrl, localPath);
    } catch (e) {
      if (e.message && e.message.includes('Unexpected HTTP status code: 403')) {
        const message = `${basename(remotePath)} was not found on the server with 403 status`;
        throw new errors.FileNotFound(message);
      } else throw e;
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
   * @returns {Promise} s3 uri of destination file
   */
  async sync(remotePath, bucket, key) {
    validateHost(this.host);

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
      const headResponse = await got.head(remoteUrl);
      headers = headResponse.headers;
    } catch (err) {
      log.info(`HEAD failed for ${remoteUrl} with error: ${err}.`);
    }
    const contentType = headers['content-type'] || lookupMimeType(key);

    const pass = new PassThrough();
    got.stream(remoteUrl).pipe(pass);

    await promiseS3Upload({
      Bucket: bucket,
      Key: key,
      Body: pass,
      ContentType: contentType
    });

    log.info('Uploading to s3 is complete (http)', s3uri);
    return s3uri;
  }
}

module.exports = HttpProviderClient;
