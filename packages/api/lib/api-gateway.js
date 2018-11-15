'use strict';

const { Cookie } = require('tough-cookie');

/**
 * Normalize the headers in an API Gateway Lambda Proxy request or response
 *
 * From the AWS docs:
 *
 *   - The headers key can only contain single-value headers.
 *   - The multiValueHeaders key can contain multi-value headers as well as
 *     single-value headers.
 *   - If you specify values for both headers and multiValueHeaders, API Gateway
 *     merges them into a single list. If the same key-value pair is specified
 *     in both, only the values from multiValueHeaders will appear in the merged
 *     list.
 * @param {Object} request - an API Gateway Lambda Proxy request or response
 * @returns {Object} a mapping of lower-case header names to arrays of header
 *   values
 */
function normalizeHeaders(request) {
  const headers = {};

  Object.entries(request.headers || {}).forEach(([key, value]) => {
    headers[key.toLowerCase()] = [value];
  });

  Object.entries(request.multiValueHeaders || {}).forEach(([key, values]) => {
    headers[key.toLowerCase()] = values;
  });

  return headers;
}
exports.normalizeHeaders = normalizeHeaders;

/**
 * Given an API Gateway request, return a cookie
 *
 * @param {Object} request - an API Gateway Lambda Proxy request or response
 * @param {string} key - the cookie to be retrieved
 * @returns {Cookie|undefined} a Cookie object, if the requested cookie was
 *   present, or `undefined` if it was not
 */
function getCookie(request, key) {
  const headers = normalizeHeaders(request);

  const cookieHeaders = headers.cookie || [];
  const cookies = cookieHeaders.map(Cookie.parse);
  return cookies.find((c) => c.key === key);
}
exports.getCookie = getCookie;
