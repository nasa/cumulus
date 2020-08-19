'use strict';

const got = require('got');
const { parseString } = require('xml2js');
const { deprecate } = require('@cumulus/common/util');
const {
  ValidationError,
  updateToken,
  getUrl,
  xmlParseOptions,
  getHost,
  hostId,
} = require('./utils');
const {
  constructOnlineAccessUrl,
  getGranuleTemporalInfo,
  isCMRFile,
  metadataObjectFromCMRFile,
  publish2CMR,
  granulesToCmrFileObjects,
  reconcileCMRMetadata,
  updateCMRMetadata,
} = require('./cmr-utils');

/**
 * Get the CMR JSON metadata from the cmrLink
 *
 * @param {string} cmrLink - link to concept in CMR
 * @returns {Object} - metadata as a JS object, undefined if not
 * found
 */
async function getMetadata(cmrLink) {
  deprecate('@cumulus/cmrjs/getMetadata(cmrLink)', '1.22.1', '@cumulus/cmr-client/CMR.getGranuleMetadata(cmrLink)');
  const response = await got.get(cmrLink);

  if (response.statusCode !== 200) {
    return undefined;
  }

  const body = JSON.parse(response.body);

  return body.feed.entry[0];
}

/**
 * Get the full metadata from CMR as a JS object by getting
 * the echo10 metadata
 *
 * @param {string} cmrLink - link to concept in CMR. This link is a json
 * link that comes from task output.
 * @returns {Object} - Full metadata as a JS object
 */
async function getFullMetadata(cmrLink) {
  deprecate('@cumulus/cmrjs/getFullMetadata(cmrLink)', '1.22.1');
  const xmlLink = cmrLink.replace('json', 'echo10');

  const response = await got.get(xmlLink);

  if (response.statusCode !== 200) {
    return undefined;
  }

  const xmlObject = await new Promise((resolve, reject) => {
    parseString(response.body, xmlParseOptions, (err, res) => {
      if (err) reject(err);
      resolve(res);
    });
  });

  return xmlObject.Granule;
}

module.exports = {
  constructOnlineAccessUrl,
  ValidationError,
  getFullMetadata,
  getGranuleTemporalInfo,
  getHost,
  getMetadata,
  getUrl,
  hostId,
  isCMRFile,
  metadataObjectFromCMRFile,
  publish2CMR,
  reconcileCMRMetadata,
  granulesToCmrFileObjects,
  updateCMRMetadata,
  updateToken,
};
