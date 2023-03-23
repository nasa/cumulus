'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const path = require('path');
const fs = require('fs');
const { buildUploaderClient } = require('./uploader');

/**
 * Return Input payload
 *
 * @param {Object} event - input from the message adapter
 * @returns {Object} sample JSON object
 */
async function sendPAN(event) {
  const config = event.config;
  const provider = config.provider;
  const remoteDir = config.remoteDir;
  const panName = config.pdrName.replace('.pdr', '.pan');
  const uploadPath = path.join(remoteDir, panName);

  // TODO - replace with PAN generation
  const localPath = '/tmp/test.pan';
  fs.writeFile(localPath, 'Hello world!', (err) => {
    if (err) {
      console.error(err);
    }
  });

  const providerClient = buildUploaderClient(provider);
  await providerClient.upload({ localPath, uploadPath });

  return event;
}
/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - sample JSON object
 */
async function handler(event, context) {
  return await cumulusMessageAdapter.runCumulusTask(sendPAN, event, context);
}

exports.handler = handler;
exports.sendPAN = sendPAN; // exported to support testing
