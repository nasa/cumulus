'use strict';

const http = require('http');
const https = require('https');
const request = require('request'); // eslint-disable-line node/no-extraneous-require
const { parse } = require('url');

function genUriOptions(uri, headers) {
  return {
    uri,
    method: 'GET',
    followRedirect: false,
    headers
  };
}

function authString() {
  return Buffer.from(
    `${process.env.EARTHDATA_USER}:${
      process.env.EARTHDATA_PASS}`
  ).toString('base64');
}

async function followRedirects({ currentRedirect, numRedirects, uriOptions }) {
  return new Promise((resolve, reject) => {
    if (currentRedirect === numRedirects) {
      return resolve(uriOptions);
    }
    return request(uriOptions, async (err, res, _) => {
      if (err) return reject(err);

      let updatedOptions = { ...uriOptions };
      let cookies = uriOptions.headers.cookie || '';
      if (res.headers['set-cookie'] !== undefined) {
        cookies += `${res.headers['set-cookie'].join('; ')}; `;
      }
      updatedOptions.headers.cookie = cookies;

      updatedOptions = genUriOptions(res.headers.location, updatedOptions.headers);
      updatedOptions = await followRedirects({
        currentRedirect: currentRedirect + 1,
        numRedirects,
        uriOptions: updatedOptions
      });
      return resolve(updatedOptions);
    });
  });
}

module.exports.followRedirects = followRedirects;

module.exports.httpBasicAuthMixin = (superclass) => class extends superclass {
  /**
   * get readable stream of the remote file
   *
   * @param {string} url - url of the remote file
   * @returns {Promise} readable stream of the remote file
   */
  async _getReadableStream(url) {
    const uriOptions = genUriOptions(url, {
      authorization: `Basic ${authString()}`
    });
    const numRedirects = parseInt(process.env.NUM_AUTH_REDIRECTS, 10) || 2;
    const finalUriOptions = await followRedirects({ uriOptions, numRedirects, currentRedirect: 0 });
    const transport = url.startsWith('https://') ? https : http;
    const parsedUrl = parse(url);
    const options = {
      host: parsedUrl.hostname,
      path: parsedUrl.pathname,
      headers: {
        cookie: finalUriOptions.headers.cookie
      }
    };

    return new Promise((resolve, reject) => {
      transport.get(options, (res) => {
        if (res.statusCode !== 200) {
          const err = new Error(`Unexpected HTTP status code: ${res.statusCode}`);
          err.code = res.statusCode;
          return reject(err);
        }
        return resolve(res);
      }).on('error', reject);
    });
  }
};
