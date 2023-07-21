'use strict';

const fs = require('fs');
const path = require('path');
const { tmpdir } = require('os');
const Logger = require('@cumulus/logger');
const { generatePAN } = require('@cumulus/api/lib/pdrHelpers');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const HttpProviderClient = require('@cumulus/ingest/HttpProviderClient');
const S3ProviderClient = require('@cumulus/ingest/S3ProviderClient');

const log = new Logger({ sender: '@cumulus/send-pan' });

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
 * Send PAN and return the uri of the uploaded pan
 *
 * @param {object} event - input from the message adapter
 * @returns {object} the uri of the pan
 */
async function sendPAN(event) {
  const { config, input } = event;
  const provider = config.provider;
  const remoteDir = config.remoteDir;
  if (!remoteDir) {
    log.debug('remoteDir is not configured, PAN is not sent');
    return input;
  }

  const panName = input.pdr.name.replace(/\.pdr/gi, '.pan');
  const uploadPath = path.join(remoteDir, panName);

  const pan = generatePAN();

  const localPath = path.join(tmpdir(), panName);
  fs.writeFileSync(localPath, pan);

  const providerClient = buildUploaderClient(provider);
  const uri = await providerClient.upload({ localPath, uploadPath });

  fs.unlinkSync(localPath);
  return {
    ...input,
    pan: { uri },
  };
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
