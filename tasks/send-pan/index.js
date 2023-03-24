'use strict';

const pdrs = require('@cumulus/api/models/pdrs');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const fs = require('fs');
const path = require('path');
const { buildUploaderClient } = require('./uploader');

/**
 * Return Input payload
 *
 * @param {object} event - input from the message adapter
 * @returns {object} sample JSON object
 */
async function sendPAN(event) {
  const config = event.config;
  const provider = config.provider;
  const remoteDir = config.remoteDir;
  const panName = config.pdrName.replace('.pdr', '.pan');
  const uploadPath = path.join(remoteDir, panName);

  const pan = pdrs.generatePAN();

  const localPath = `/tmp/${panName}`;
  fs.writeFile(localPath, pan, (err) => {
    if (err) {
      throw new Error(`Unable to write file ${localPath}: ${err.message}`);
    }
  });

  const providerClient = buildUploaderClient(provider);
  await providerClient.upload({ localPath, uploadPath });

  fs.unlink(localPath, (err) => {
    if (err) {
      throw new Error(`Unable to unlink file ${localPath}: ${err.message}.`);
    }
  });

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
