'use strict';

const {
  ValidationError,
  updateToken,
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

module.exports = {
  constructOnlineAccessUrl,
  ValidationError,
  getGranuleTemporalInfo,
  getHost,
  hostId,
  isCMRFile,
  metadataObjectFromCMRFile,
  publish2CMR,
  reconcileCMRMetadata,
  granulesToCmrFileObjects,
  updateCMRMetadata,
};
