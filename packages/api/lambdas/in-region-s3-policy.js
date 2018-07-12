'use strict';

const got = require('got');
const { s3 } = require('@cumulus/common/aws');

/**
 * Bucket policy template for S3 GET access. Currently pointing to an
 * ARN of a test bucket for the prototyping purposes.
 */
const policyTemplate = {
  Version: '2012-10-17',
  Id: 'S3PrototypePolicy',
  Statement: [
    {
      Sid: 'Stmt1522859852334',
      Effect: 'Allow',
      Principal: '*',
      Action: ['s3:GetObject'],
      Resource: [''] // gets set by generatePolicyFromIpAddresses
    }
  ]
};

// Hard coded for now for the purposes of the prototype
const defaultRegion = 'us-east-1';
const defaultBucket = 'cumulus-test-s3-prototype';

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
  return got.get(url, { json: true })
    .then((json) => json.body.prefixes);
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
 * @param {string} bucket - S3 bucket
 * @returns {Object} - S3 bucket policy
 */
function generatePolicyFromIpAddresses(ips, bucket) {
  const policy = policyTemplate;

  policy.Statement[0].Resource[0] = `arn:aws:s3:::${bucket}/*`;
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
  * @param {string} bucket - S3 bucket
 * @returns {Promise<Object>} - S3 bucket policy
 */
function generatePolicy(url, region, bucket) {
  return module.exports.getIpRanges(url)
    .then((ranges) => getIpsForRegion(ranges, region))
    .then((ips) => generatePolicyFromIpAddresses(ips, bucket));
}

/**
 * Update the policy on the given bucket
 *
 * @param {string} bucket - bucket name
 * @param {Object} policy - policy object
 * @returns {Promise<Object>} - return of putBucketPolicy
 */
async function updateBucketPolicy(bucket, policy) {
  // convert policy JSON into string and assign into params
  const bucketPolicyParams = { Bucket: bucket, Policy: JSON.stringify(policy) };

  // set the new policy on the selected bucket
  return s3().putBucketPolicy(bucketPolicyParams).promise();
}

/**
 * Handler
 *
 * @param {Object} event - SNS event passed to lambda. Message format:
 * { "create-time":"yyyy-mm-ddThh:mm:ss+00:00",
 *  "synctoken":"0123456789",
 *  "md5":"6a45316e8bc9463c9e926d5d37836d33",
 *  "url":"https://ip-ranges.amazonaws.com/ip-ranges.json"  }
 *  A bucket param can be specified for testing
 * @param {Object} context - AWS Lambda context
 * @param {*} callback - callback function
 * @returns {undefined} - none
 */
function handler(event, context, callback) {
  // Extract the message from the SNS event
  const message = JSON.parse(event.Records[0].Sns.Message);

  const bucket = message.bucket || defaultBucket;

  generatePolicy(message.url, defaultRegion, bucket)
    .then((policy) => updateBucketPolicy(bucket, policy))
    .then((data) => callback(null, data))
    .catch((err) => callback(err));
}

module.exports = {
  handler,

  // for testing
  generatePolicy,
  getIpRanges
};
