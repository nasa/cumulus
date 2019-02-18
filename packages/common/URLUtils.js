'use strict';

/**
 * A collection of utilities for working with URLs
 * @module URLUtils
 *
 * @example
 * const { buildURL } = require('@cumulus/common/URLUtils');
 *
 * buildURL({ protocol: 'http', host: 'example.com' }); // => 'http://example.com'
 */

const isString = require('lodash.isstring');
const urljoin = require('url-join');
const { URL } = require('url');
const { isNil } = require('./util');

/**
 * Build a URL
 *
 * @param {Object} params - URL parameters
 * @param {string} params.protocol - the protocol ('http', 'ftp', 's3', etc)
 * @param {string} params.host - the host
 * @param {string|integer} [params.port] - the port
 * @param {string|string[]} [params.path] - path segment(s) to add to the end of
 *   the URL.  Can be either a string or an array of strings, which will be
 *   joined together.
 * @returns {string} a URL
 * @throws {TypeError} if protocol or host are not specified
 *
 * @static
 *
 * @example
 * buildURL({
 *   protocol: 'http'
 *   host: 'example.com',
 *   port: 8080,
 *   path: ['path', 'to', 'file.txt']
 * }); // => 'http://example.com:8080/path/to/file.txt'
 */
const buildURL = ({
  protocol,
  host,
  port,
  path = []
}) => {
  if (isNil(protocol)) throw new TypeError('protocol is required');
  if (isNil(host)) throw new TypeError('host is required');

  const url = new URL(`${protocol}://${host}`);

  if (protocol !== 's3') url.port = port;

  if (isString(path)) url.pathname = path;
  else if (path.length > 0) url.pathname = urljoin(...path);

  return url.toString().replace(/\/$/, '');
};

module.exports = {
  buildURL
};
