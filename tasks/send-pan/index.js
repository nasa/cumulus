'use strict';

const fs = require('fs');
const path = require('path');
const { generatePAN } = require('@cumulus/api/lib/pdrHelpers');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const HttpProviderClient = require('@cumulus/ingest/HttpProviderClient');
const S3ProviderClient = require('@cumulus/ingest/S3ProviderClient');

const buildUploaderClient = (providerConfig = {}) => {
  switch (providerConfig.protocol) {
  case 'http':
  case 'https':
    return new HttpProviderClient(providerConfig);
  case 's3':
    return new S3ProviderClient({ bucket: providerConfig.host });
  default:
    throw new Error(`Protocol ${providerConfig.protocol} is not supported.`);
  }
};

/**
 * Send PAN and return the input payload
 *
 * @param {object} event - input from the message adapter
 * @returns {object} sample JSON object
 */
async function sendPAN(event) {
  const config = event.config;
  const provider = config.provider;
  const remoteDir = config.remoteDir;
  const panName = config.pdrName.replace(/\.pdr/gi, '.pan');
  const uploadPath = path.join(remoteDir, panName);

  const pan = generatePAN();

  const localPath = `/tmp/${panName}`;
  fs.writeFileSync(localPath, pan);

  const providerClient = buildUploaderClient(provider);
  await providerClient.upload({ localPath, uploadPath });

  fs.unlinkSync(localPath);
  return event;
}

/**
 * Lambda handler
 *
 * @param {object} event      - a Cumulus Message
 * @param {object} context    - an AWS Lambda context
 * @returns {Promise<object>} - sample JSON object
 */
async function handler(event, context) {
  return await cumulusMessageAdapter.runCumulusTask(sendPAN, event, context);
}

exports.handler = handler;
exports.sendPAN = sendPAN; // exported to support testing
