'use strict';

const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const urljoin = require('url-join');
const Crawler = require('simplecrawler');
const http = require('http');
const https = require('https');
const httpMixin = require('./http');
const { log, aws: { buildS3Uri, promiseS3Upload } } = require('@cumulus/common');
const mkdirp = require('mkdirp');
const pump = require('pump');
const errors = require('@cumulus/common/errors');
const request = require('request');

const genUriOptions = function(uri, headers) {
  return {
    uri,
    method: 'GET',
    followRedirect: false,
    jar: true,
    headers
  }
}

function authString() {
  return new Buffer(
    process.env.EARTHDATA_USER + ':' +
    process.env.EARTHDATA_PASS
  ).toString('base64');
}

async function followRedirects({currentRedirect, numRedirects, uriOptions}) {
  return new Promise((resolve, reject) => {
    if (currentRedirect === numRedirects) {
      resolve(uriOptions.uri);
    } else {
      request(uriOptions, async (err, res, body) => {
        if (err) reject(err);
        uriOptions = genUriOptions(res.headers.location, uriOptions.headers);
        const uri = await followRedirects({
          currentRedirect: currentRedirect + 1,
          numRedirects,
          uriOptions
        });
        resolve(uri);
      })
    }
  });
}
/**
 * Downloads a given http URL to disk
 *
 * @param {string} url - a http(s) url
 * @param {string} filepath - the local path to save the downloaded file
 * @returns {Promise} undefined
 */
async function downloadToDisk(url, filepath) {
  return pump(request(genUriOptions(url)), fs.createWriteStream(filepath));
}

module.exports.httpAuthMixin = (superclass) => class extends superclass {
  async download(uri) {
    console.log('in download!')
    const uriOptions = genUriOptions(uri, {
      authorization: `Basic ${authString()}`
    });
    const url = await followRedirects({uriOptions, numRedirects: 3, currentRedirect: 0});
    console.log(url);
    return await downloadToDisk(url, './test.tif');
  }

  /**
   * get readable stream of the remote file
   *
   * @param {string} url - url of the remote file
   * @returns {Promise} readable stream of the remote file
   */
  async _getReadableStream(url) {
    const transport = url.indexOf('https://') === 0 ? https : http;
    return new Promise((resolve, reject) => {
      transport.get(url, (res) => {
        if (res.statusCode !== 200) {
          const err = new Error(`Unexpected HTTP status code: ${res.statusCode}`);
          err.code = res.statusCode;
          return reject(err);
        }
        return resolve(res);
      }).on('error', reject);
    });
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

    const readable = await this._getReadableStream(remoteUrl);

    const pass = new PassThrough();
    readable.pipe(pass);

    const params = { Bucket: bucket, Key: key, Body: pass };
    await promiseS3Upload(params);
    log.info('Uploading to s3 is complete (http)', s3uri);
    return s3uri;
  }
}
