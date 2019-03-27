'use strict';

const http = require('@cumulus/common/http');
const isIp = require('is-ip');
const path = require('path');
const mime = require('mime-types');
const { PassThrough } = require('stream');
const Crawler = require('simplecrawler');
const got = require('got');
const { log, aws: { buildS3Uri, s3 } } = require('@cumulus/common');
const { isValidHostname } = require('@cumulus/common/string');
const { buildURL } = require('@cumulus/common/URLUtils');
const errors = require('@cumulus/common/errors');

const validateHost = (host) => {
  if (isValidHostname(host) || isIp(host)) return;

  throw new TypeError(`provider.host is not a valid hostname or IP: ${host}`);
};

module.exports.httpMixin = (superclass) => class extends superclass {
  /**
   * List all PDR files from a given endpoint
   *
   * @returns {Promise.<Array>} of a list of files
   */
  list() {
    validateHost(this.provider.host);

    const pattern = /<a href="([^>]*)">[^<]+<\/a>/;

    const c = new Crawler(
      buildURL({
        protocol: this.provider.protocol,
        host: this.provider.host,
        port: this.provider.port,
        path: this.path
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
      c.on('fetchcomplete', (queueItem, responseBuffer) => {
        const lines = responseBuffer.toString().trim().split('\n');
        lines.forEach((line) => {
          const split = line.trim().split(pattern);
          if (split.length === 3) {
          // Some providers provide files with one number after the dot (".") ex (tmtdayacz8110_5.6)
            if (split[1].match(/^(.*\.[\w\d]{1,4})\s*$/) !== null) {
              const name = split[1];
              files.push({
                name,
                path: this.path
              });
            }
          }
        });

        return resolve(files);
      });

      c.on('fetchtimeout', reject);
      c.on('fetcherror', reject);
      c.on('fetchclienterror', () => reject(new errors.RemoteResourceError('Connection Refused')));

      c.on('fetch404', (err) => {
        const e = {
          message: `Received a 404 error from ${this.endpoint}. Check your endpoint!`,
          details: err
        };

        return reject(e);
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
    validateHost(this.provider.host);

    const remoteUrl = buildURL({
      protocol: this.provider.protocol,
      host: this.provider.host,
      port: this.provider.port,
      path: remotePath
    });

    log.info(`Downloading ${remoteUrl} to ${localPath}`);
    try {
      await http.download(remoteUrl, localPath);
    }
    catch (e) {
      if (e.message && e.message.includes('Unexpected HTTP status code: 403')) {
        const message = `${path.basename(remotePath)} was not found on the server with 403 status`;
        throw new errors.FileNotFound(message);
      }
      else throw e;
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
    validateHost(this.provider.host);

    const remoteUrl = buildURL({
      protocol: this.provider.protocol,
      host: this.provider.host,
      port: this.provider.port,
      path: remotePath
    });

    const s3uri = buildS3Uri(bucket, key);
    log.info(`Sync ${remoteUrl} to ${s3uri}`);

    let headers = {};
    try {
      const headResponse = await got.head(remoteUrl);
      headers = headResponse.headers;
    }
    catch (err) {
      log.info(`HEAD failed for ${remoteUrl} with error: ${err}.`);
    }
    const contentType = headers['content-type'] || mime.lookup(key) || 'binary/octet';

    const pass = new PassThrough();
    got.stream(remoteUrl).pipe(pass);

    await s3().upload({
      Bucket: bucket,
      Key: key,
      Body: pass,
      ContentType: contentType
    }).promise();

    log.info('Uploading to s3 is complete (http)', s3uri);
    return s3uri;
  }
};
