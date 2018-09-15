'use strict';

const http = require('@cumulus/common/http');
const path = require('path');
const { PassThrough } = require('stream');
const urljoin = require('url-join');
const Crawler = require('simplecrawler');
const got = require('got');
const { log, aws: { buildS3Uri, s3 } } = require('@cumulus/common');
const errors = require('@cumulus/common/errors');

module.exports.httpMixin = (superclass) => class extends superclass {
  /**
   * List all PDR files from a given endpoint
   *
   * @returns {Promise.<Array>} of a list of files
   */
  list() {
    const pattern = /<a href="([^>]*)">[^<]+<\/a>/;
    const c = new Crawler(urljoin(this.host, this.path));

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
        for (const line of lines) {
          const split = line.trim().split(pattern);
          if (split.length === 3) {
          // Some providers provide files with one number after the dot (".") ex (tmtdayacz8110_5.6)
            if (split[1].match(/^(.*\.[\w\d]{1,4})$/) !== null) {
              const name = split[1];
              files.push({
                name,
                path: this.path
              });
            }
          }
        }

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
    const remoteUrl = urljoin(this.host, remotePath);

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
    const remoteUrl = urljoin(this.host, remotePath);
    const s3uri = buildS3Uri(bucket, key);
    log.info(`Sync ${remoteUrl} to ${s3uri}`);

    const pass = new PassThrough();
    got.stream(remoteUrl).pipe(pass);

    await s3().upload({
      Bucket: bucket,
      Key: key,
      Body: pass
    }).promise();

    log.info('Uploading to s3 is complete', s3uri);
    return s3uri;
  }
};
