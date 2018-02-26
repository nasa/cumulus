'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const urljoin = require('url-join');
const Crawler = require('simplecrawler');
const http = require('http');
const https = require('https');
const mkdirp = require('mkdirp');
const pump = require('pump');
const syncUrl = require('@cumulus/common/aws').syncUrl;
const errors = require('@cumulus/common/errors');

/**
 * Downloads a given http URL to disk
 *
 * @param {string} url - a http(s) url
 * @param {string} filepath - the local path to save the downloaded file
 * @returns {Promise} undefined
 */
async function downloadToDisk(url, filepath) {
  const transport = url.indexOf('https://') === 0 ? https : http;
  return new Promise((resolve, reject) => {
    transport.get(url, (res) => {
      if (res.statusCode !== 200) {
        const err = new Error(`Unexpected HTTP status code: ${res.statusCode}`);
        err.code = res.statusCode;
        return reject(err);
      }
      return mkdirp(path.dirname(filepath), (err) => {
        if (err) return reject(err);
        const file = fs.createWriteStream(filepath);
        return pump(res, file, (e) => {
          if (e) return reject(e);
          return resolve();
        });
      });
    }).on('error', reject);
  });
}

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
   * Downloads a given url and upload to a given S3 location
   *
   * @param {string} _path - the path to download the file from
   * @param {string} bucket - the bucket to upload the file to
   * @param {string} key - the file prefix on s3
   * @param {string} filename - the filename
   * @returns {Promise.<string>} a s3 uri
   */
  async sync(_path, bucket, key, filename) {
    await syncUrl(urljoin(this.host, _path, filename), bucket, path.join(key, filename));
    return urljoin('s3://', bucket, key, filename);
  }

  /**
   * Downloads the file to disk, difference with sync is that
   * this method involves no uploading to S3
   *
   * @param {string} _path - the path to download the file from
   * @param {string} filename - the filename
   * @returns {Promise.<string>} the path to the temp file
   */
  async download(_path, filename) {
    // let's stream to file
    const tempFile = path.join(os.tmpdir(), filename);
    const uri = urljoin(this.host, _path, filename);

    await downloadToDisk(uri, tempFile);

    return tempFile;
  }
};
