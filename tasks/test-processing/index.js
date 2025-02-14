'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { generateCmrFilesForGranules } = require('@cumulus/integration-tests');
const { promiseS3Upload } = require('@cumulus/aws-client/S3');
const path = require('path');
const fs = require('fs');
const img = require('./data/testBrowse.jpg');

async function uploadFakeBrowse(input) {
  const uploadPromises = [];
  input.granules.forEach((granule) => {
    granule.files
      .filter((file) => file.type === 'data')
      .forEach((file) => {
        const browseFile = { ...file };
        const browseName = browseFile.key;
        browseFile.key = browseName.replace(path.extname(browseName), '.jpg');
        browseFile.fileName = browseFile.fileName.replace(path.extname(browseFile.fileName), '.jpg');
        browseFile.type = 'browse';

        const browseStream = fs.createReadStream(img);
        uploadPromises.push(promiseS3Upload({
          Bucket: browseFile.bucket,
          Key: (`file-staging/${browseFile.fileName}`),
          Body: browseStream,
        }));
        granule.files.push(browseFile);
      });
  });
  await Promise.all(uploadPromises);
  return input.granules;
}

/**
 * For each granule, create a CMR XML file and store to S3
 *
 * @param {Object} event - an ingest object
 * @returns {Array<string>} - the list of s3 locations for granule files
 */

async function fakeProcessing(event) {
  const input = event.input;
  const collection = event.config.collection;
  if (collection.name.includes('_test')) {
    const idx = collection.name.indexOf('_test');
    collection.name = collection.name.substring(0, idx);
  }

  if (event.config.generateFakeBrowse) {
    input.granules = await uploadFakeBrowse(input);
  }

  const outputFiles = await generateCmrFilesForGranules({
    granules: input.granules,
    collection,
    bucket: event.config.bucket,
    cmrMetadataFormat: event.config.cmrMetadataFormat,
    additionalUrls: event.config.additionalUrls,
  });
  return { files: outputFiles, granules: input.granules };
}

/**
 * Lambda handler that returns the expected input for the Post to CMR task
 *
 * @param {Object} event - a description of the ingestgranules
 * @param {Object} context - an AWS Lambda context
 * @returns {Promise<string[]>} - the list of s3 locations for granule files
 */
async function handler(event, context) {
  return await cumulusMessageAdapter.runCumulusTask(fakeProcessing, event, context);
}

exports.handler = handler;
