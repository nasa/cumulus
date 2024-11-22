'use strict';

import cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
import get from 'lodash/get';
import flatten from 'lodash/flatten';
import keyBy from 'lodash/keyBy';
import path from 'path';

import S3 from '@cumulus/aws-client/S3';
const { InvalidArgument } = require('@cumulus/errors');

// const {
//   handleDuplicateFile,
//   unversionFilename,
//   duplicateHandlingType,
// } = require('@cumulus/ingest/granule');
import {
    handleDuplicateFile,
    unversionFilename,
    duplicateHandlingType,
} from '@cumulus/ingest/granule';
// const {
//   isCMRFile,
//   isISOFile,
//   metadataObjectFromCMRFile,
//   granulesToCmrFileObjects,
// } = require('@cumulus/cmrjs');
import {
    isCMRFile,
    isISOFile,
    metadataObjectFromCMRFile,
    granulesToCmrFileObjects
 } from '@cumulus/cmrjs';
// const BucketsConfig = require('@cumulus/common/BucketsConfig');
import { BucketsConfig } from '@cumulus/common/BucketsConfig';
// const { urlPathTemplate } = require('@cumulus/ingest/url-path-template');
import { urlPathTemplate } from '@cumulus/ingest/url-path-template';
// const { isFileExtensionMatched } = require('@cumulus/message/utils');
import { isFileExtensionMatched } from '@cumulus/message/utils';
// const log = require('@cumulus/common/log');
import { log } from '@cumulus/common';
// const { constructCollectionId } = require('@cumulus/message/Collections');
import { constructCollectionId } from '@cumulus/message/Collections';

import { ApiFile, ApiGranule, CollectionRecord } from '@cumulus/types';
import { AssertionError } from 'assert';

const MB = 1024 * 1024;

/**
 * Move Granule files to final location.
 * See the schemas directory for detailed input and output schemas.
 *
 * @param {Object} event - Lambda function payload
 * @param {Object} event.config - the config object
 * @param {Object} event.config.buckets - Buckets config
 * @param {string} event.config.distribution_endpoint - distribution endpoint for the api
 * @param {Object} event.config.collection - collection configuration
 *                     https://nasa.github.io/cumulus/docs/data-cookbooks/setup#collections
 * @param {boolean} [event.config.moveStagedFiles=true] - set to false to skip moving files
 *                                 from staging to final bucket. Mostly useful for testing.
 * @param {Object} event.input - a granules object containing an array of granules
 * @param {Array<import('@cumulus/types').ApiGranuleRecord>} event.input.granules
 *
 * @returns {Promise} returns the promise of an updated event object
 */
async function moveGranules(event) {
  // We have to post the meta-xml file of all output granules
  const config = event.config;
  const bucketsConfig = new BucketsConfig(config.buckets);
  const moveStagedFiles = get(config, 'moveStagedFiles', true);
  const s3MultipartChunksizeMb = config.s3MultipartChunksizeMb
    ? config.s3MultipartChunksizeMb : process.env.default_s3_multipart_chunksize_mb;

  const duplicateHandling = duplicateHandlingType(event);
  const granuleMetadataFileExtension = get(config, 'collection.meta.granuleMetadataFileExtension');

  log.debug(`moveGranules config duplicateHandling: ${duplicateHandling}, `
    + `moveStagedFiles: ${moveStagedFiles}, `
    + `s3MultipartChunksizeMb: ${s3MultipartChunksizeMb}, `
    + `granuleMetadataFileExtension ${granuleMetadataFileExtension}`);

  let filterFunc;
  if (granuleMetadataFileExtension) {
    filterFunc = (fileobject) => isFileExtensionMatched(fileobject, granuleMetadataFileExtension);
  } else {
    filterFunc = (fileobject) => isCMRFile(fileobject) || isISOFile(fileobject);
  }
  const granulesInput = event.input.granules;
  const cmrFiles = granulesToCmrFileObjects(granulesInput, filterFunc);
  const granulesByGranuleId = keyBy(granulesInput, 'granuleId');

  let movedGranulesByGranuleId;

  // update granule collections in store if necessary
  await Promise.all(granulesInput.map(
    async (granule) => await updateGranuleCollection(granule, config.collection)
  ));

  // allows us to disable moving the files
  if (moveStagedFiles) {
    // Update all granules with aspirational metadata
    // (where the files should end up after moving).
    const granulesToMove = await updateGranuleMetadata(
      granulesByGranuleId, config.collection, cmrFiles, bucketsConfig
    );

    // Move files from staging location to final location
    movedGranulesByGranuleId = await moveFilesForAllGranules(
      granulesToMove, duplicateHandling, s3MultipartChunksizeMb
    );
  } else {
    movedGranulesByGranuleId = granulesByGranuleId;
  }

  const granuleDuplicates = buildGranuleDuplicatesObject(movedGranulesByGranuleId);
  return {
    granuleDuplicates,
    granules: Object.values(movedGranulesByGranuleId),
  };
}

/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
async function handler(event, context) {
  return await cumulusMessageAdapter.runCumulusTask(moveGranules, event, context);
}

exports.handler = handler;
exports.moveGranules = moveGranules;
exports.updateGranuleMetadata = updateGranuleMetadata;
