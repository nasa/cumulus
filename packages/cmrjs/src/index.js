'use strict';

const {
  ValidationError,
} = require('./utils');
const {
  addEtagsToFileObjects,
  constructOnlineAccessUrl,
  getGranuleTemporalInfo,
  getCollectionsByShortNameAndVersion,
  getUserAccessibleBuckets,
  isCMRFile,
  isISOFile,
  mapFileEtags,
  metadataObjectFromCMRFile,
  publish2CMR,
  granulesToCmrFileObjects,
  reconcileCMRMetadata,
  removeEtagsFromFileObjects,
  removeFromCMR,
  updateCMRMetadata,
} = require('./cmr-utils');

module.exports = {
  addEtagsToFileObjects,
  constructOnlineAccessUrl,
  ValidationError,
  getGranuleTemporalInfo,
  getCollectionsByShortNameAndVersion,
  getUserAccessibleBuckets,
  isCMRFile,
  isISOFile,
  mapFileEtags,
  metadataObjectFromCMRFile,
  publish2CMR,
  reconcileCMRMetadata,
  removeEtagsFromFileObjects,
  removeFromCMR,
  granulesToCmrFileObjects,
  updateCMRMetadata,
};
