'use strict';

const get = require('lodash/get');
const pFilter = require('p-filter');
const { s3ObjectExists } = require('@cumulus/aws-client/S3');
const { buildProviderClient } = require('@cumulus/ingest/providerClientUtils');
const { runCumulusTask } = require('@cumulus/cumulus-message-adapter-js');

/**
 * Fetch a list of files from the provider
 *
 * @param {Object} params
 * @param {Object} params.providerConfig - the connection config for the
 *   provider
 * @param {bool} params.useList - flag to tell ftp server to use 'LIST'
 *   instead of 'STAT'
 * @param {number} [params.httpRequestTimeout=300] - seconds for http provider
 * to wait before timing out
 * @param {string} params.path - the provider path to search
 * @returns {Array<Object>} a list of discovered file objects
 */
const listFiles = async (params) => {
  const { providerConfig, useList, path, httpRequestTimeout = 300 } = params;

  const provider = buildProviderClient({
    ...providerConfig,
    useList,
    httpRequestTimeout,
  });

  try {
    await provider.connect();

    return await provider.list(path);
  } finally {
    await provider.end();
  }
};

const isPdrFile = ({ name }) => name.toUpperCase().endsWith('.PDR');

const isNewPdr = (bucket, stackName, folder, pdr) =>
  s3ObjectExists({
    Bucket: bucket,
    Key: `${stackName}/${folder}/${pdr.name}`,
  }).then((pdrIsInS3) => pdrIsInS3 === false);

/**
 * Discover PDRs
 *
 * @param {Object} event - a simplified Cumulus event with input and config properties
 * @returns {Promise<Array>} - resolves to an array describing PDRs
 */
const discoverPdrs = async ({ config }) => {
  const discoveredFiles = await listFiles({
    providerConfig: config.provider,
    useList: config.useList,
    httpRequestTimeout: config.httpRequestTimeout,
    path: config.provider_path,
  });

  const discoveredPdrs = discoveredFiles.filter(isPdrFile);

  let pdrsToReturn;
  if (get(config, 'force', false)) {
    pdrsToReturn = discoveredPdrs;
  } else {
    pdrsToReturn = await pFilter(
      discoveredPdrs,
      (pdr) => isNewPdr(config.bucket, config.stack, 'pdrs', pdr)
    );
  }

  const pdrNameFilter = get(config, 'filterPdrs', /.*/);
  return {
    pdrs: pdrsToReturn.filter(({ name }) => name.match(pdrNameFilter)),
  };
};

/**
 * Lambda handler
 *
 * @param {Object} event        - a Cumulus Message
 * @param {Object} context      - an AWS Lambda context
 * @returns {Promise<Object>}   - Returns output from task.
 *                                See schemas/output.json for detailed output schema
 */
const handler = async (event, context) => runCumulusTask(discoverPdrs, event, context);

module.exports = {
  discoverPdrs,
  handler,
};
