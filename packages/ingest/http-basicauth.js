'use strict';

const http = require('http');
const https = require('https');
const request = require('request'); // eslint-disable-line node/no-extraneous-require
const { parse } = require('url');

/**
 * genUriOptions - default options for calling the `request` module, making HTTP[|S] requests
 * @param  {string} uri     Uri to request
 * @param  {Object} headers Object of key-value pairs representing headers
 *                          sent to the `request` module
 * @returns {Object}        Options to send to the `request` module
 */
function genUriOptions(uri, headers) {
  return {
    uri,
    method: 'GET',
    followRedirect: false,
    headers
  };
}

/**
 * authString base64 encoded string used to support a basic authentication request
 * as the value for the `authorization` header
 *
 * @returns {string} Basic auth string
 */
function authString() {
  return Buffer.from(
    `${process.env.INGEST_USERNAME}:${
      process.env.INGEST_PASSWORD}`
  ).toString('base64');
}

/**
 * followRedirects - Repeatedly makes requests to the location of
 * 302 responses from the server, using the basic auth header and
 * appending cookies from each request, `numRedirects` times.
 *
 * @param  {Integer} options.currentRedirect Iterator for current redirect
 * @param  {Integer} options.numRedirects    Number of redirects to follow in this
 *                                           basic auth request cycle
 * @param  {Object}  options.uriOptions      uri options to return or
 *                                           use in the next `request` call.
 * @returns {Object}                         uri options
 */
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
