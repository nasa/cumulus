'use strict';

const request = require('request-promise');
const policyTemplate = require('./bucket-policy-template.json');

const defaultRegion = 'us-east-1';
const ipUrl = 'https://ip-ranges.amazonaws.com/ip-ranges.json';

/**
 * NOTE: The ticket for fully implenting this is CUMULUS-470
 */

/**
 * Get the IP ranges from the AWS URL
 *
 * @param {string} url - url to get IP ranges
 * @returns {Promise<Array<Object>>} - A list of IPs in the format
 * { ip_prefix: '52.20.0.0/14',
    region: 'us-east-1',
    service: 'AMAZON' }
 */
function getIpRanges(url) {
  return request({
    url: url,
    json: true
  }).then((json) => json.prefixes);
}

/**
 * Filter the IPs from the AWS url for the desired region
 *
 * @param {Array<Object>} ipRanges - IP ranges from AWS in the format:
 * { ip_prefix: '52.20.0.0/14',
    region: 'us-east-1',
    service: 'AMAZON' }
 * @param {string} region - AWS region to filter by
 * @returns {Array<string>} - an array of IP ranges
 */
function getIpsForRegion(ipRanges, region) {
  return ipRanges.filter((i) => i.region === region).map((i) => i.ip_prefix);
}

/**
 * Generate the S3 bucket policy using the bucket policy template and
 * the IP addresses to restrict access to those IP ranges
 *
 * @param {Array<string>} ips - IP ranges
 * @returns {Object} - S3 bucket policy
 */
function generatePolicyFromIpAddresses(ips) {
  const policy = policyTemplate;

  policy.Statement[0].Condition = {
    IpAddress: { 'aws:SourceIp': ips }
  };

  return policy;
}

/**
 * Generate an S3 bucket policy to restrict access to IPs within
 * a given region
 *
 * @param {string} url - URL to retrieve the IP addresses
 * @param {string} region - AWS region
 * @returns {Promise<Object>} - S3 bucket policy
 */
function generatePolicy(url, region) {
  return module.exports.getIpRanges(url)
    .then((ranges) => getIpsForRegion(ranges, region))
    .then((ips) => generatePolicyFromIpAddresses(ips));
}

/**
 * Handler
 *
 * @param {Object} event - event passed to lambda
 * @param {Object} context - AWS Lambda context
 * @param {*} callback - callback function
 * @returns {undefined} - none
 */
function handler(event, context, callback) {
  generatePolicy(ipUrl, defaultRegion)
    .then((policy) => callback(null, policy))
    .catch((err) => callback(err));
}

module.exports = {
  handler,

  // for testing
  generatePolicy,
  getIpRanges
};
