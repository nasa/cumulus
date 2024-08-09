'use strict';

const flow = require('lodash/flow');
const fs = require('fs-extra');
const replace = require('lodash/fp/replace');
const cloneDeep = require('lodash/cloneDeep');
const isEqual = require('lodash/isEqual');
const omit = require('lodash/omit');
const path = require('path');
const pWaitFor = require('p-wait-for');

const { buildS3Uri } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { randomStringFromRegex } = require('@cumulus/common/test-utils');
const {
  deleteGranule,
  getGranule,
  listGranules,
  removePublishedGranule,
} = require('@cumulus/api-client/granules');

const { waitForApiStatus } = require('./apiUtils');

/**
 * Adds updated url_path to a granule's files object.
 *
 * @param  {Array<Object>} files - array of granule files
 * @param  {string} testId - Test ID to insert into url_path per-granule
 * @param  {string} collectionUrlPath - collection
 * @returns {Array<Object>} deep copy of the specified files where each file's
 *    `url_path` property (which, if undefined, defaults to the specified
 *    collection URL path) is appended with a slash, the specified test ID, and
 *    a trailing slash
 */
const addUrlPathToGranuleFiles = (files, testId, collectionUrlPath) =>
  files.map((file) => {
    const updatedUrlPath = file.url_path === undefined ?
      collectionUrlPath :
      `${file.url_path}/`;

    return {
      ...file,
      url_path: `${updatedUrlPath}${testId}/`,
    };
  });

/**
 * Add test-unique filepath to granule file filepath/filenames.
 *
 * @param  {Array<Object>} granules - Array of granules with files to be updated
 * @param  {string} filePath - Filepath to add
 * @returns {Array<Object>} deep copy of the specified granules with the
 *    specified file path inserted immediately preceding the last part of the
 *    path of each file of each granule
 */
const addUniqueGranuleFilePathToGranuleFiles = (granules, filePath) =>
  granules.map((originalGranule) => {
    const granule = cloneDeep(originalGranule);

    granule.files.forEach((file) => {
      const { dir, base } = path.parse(file.key);
      const updateKey = `${dir}/${filePath}/${base}`;

      Object.assign(file, {
        filename: buildS3Uri(file.bucket, updateKey),
        filepath: updateKey,
      });
    });

    return granule;
  });

/**
 * Create test granule files by copying current granule files and renaming
 * with new granule id
 *
 * @param {Array<Object>} granuleFiles - array of granule file object
 * @param {string} bucket - source/destination bucket
 * @param {string} oldGranuleId - granule id of files to copy
 * @param {string} newGranuleId - new granule id
 * @returns {Promise<Array>} - AWS S3 copyObject responses
 */
async function createGranuleFiles(granuleFiles, bucket, oldGranuleId, newGranuleId) {
  const copyFile = async (file) =>
    await s3().copyObject({
      Bucket: bucket,
      CopySource: `${bucket}/${file.path}/${file.name}`,
      Key: `${file.path}/${file.name.replace(oldGranuleId, newGranuleId)}`,
    }).catch((error) => {
      console.error(`Failed to copy s3://${bucket}/${file.path}/${file.name} to s3://${bucket}/${file.path}/${file.name.replace(oldGranuleId, newGranuleId)}: ${error.message}`);
      throw error;
    });

  return await Promise.all(granuleFiles.map(copyFile));
}

/**
 * Set up files in the S3 data location for a new granule to use for this
 * test. Use the input payload to determine which files are needed and
 * return updated input with the new granule id.
 *
 * @param {string} bucket - data bucket
 * @param {string} inputPayloadJson - input payload as a JSON string
 * @param {string} granuleRegex - regex to generate the new granule id
 * @param {string} testSuffix - suffix for test-specific collection
 * @param {string} testDataFolder - test data S3 path
 * @returns {Promise<Object>} - input payload as a JS object with the updated granule ids
 */
async function setupTestGranuleForIngest(bucket, inputPayloadJson, granuleRegex, testSuffix = '', testDataFolder = undefined) {
  let payloadJson;

  if (testDataFolder) {
    payloadJson = replace(
      new RegExp('cumulus-test-data/pdrs', 'g'),
      testDataFolder,
      inputPayloadJson
    );
  } else {
    payloadJson = inputPayloadJson;
  }

  const baseInputPayload = JSON.parse(payloadJson);

  const oldGranuleId = baseInputPayload.granules[0].granuleId;
  baseInputPayload.granules[0].dataType += testSuffix;

  const newGranuleId = randomStringFromRegex(granuleRegex);
  if (baseInputPayload.pdr && baseInputPayload.pdr.name) {
    baseInputPayload.pdr.name += testSuffix;
  }

  await createGranuleFiles(
    baseInputPayload.granules[0].files,
    bucket,
    oldGranuleId,
    newGranuleId
  );

  return flow([
    JSON.stringify,
    replace(new RegExp(oldGranuleId, 'g'), newGranuleId),
    JSON.parse,
  ])(baseInputPayload);
}

const deleteGranules = async (prefix, granules) => {
  await Promise.all(
    granules.map(async (granule) => {
    // Temporary fix to handle granules that are in a bad state
    // and cannot be deleted via the API
      if (granule.published === true) {
        return await removePublishedGranule({
          prefix,
          granuleId: granule.granuleId,
          collectionId: granule.collectionId,
        });
      }
      return await deleteGranule({
        prefix,
        granuleId: granule.granuleId,
        collectionId: granule.collectionId,
      });
    })
  );
};

/**
 * Read the file, update it with the new granule id, path, collectionId, and
 * stackId, and return the file as a JS object.
 *
 * @param {string} filename - file path
 * @param {string} newGranuleId - new granule id
 * @param {string} newPath - the new data path
 * @param {string} newCollectionId - the new collection id
 * @param {stackId} stackId - the new stack id
 * @returns {Promise<Object>} - file as a JS object
 */
const loadFileWithUpdatedGranuleIdPathAndCollection = (
  filename,
  newGranuleId,
  newPath,
  newCollectionId,
  stackId
) => {
  const fileContents = fs.readFileSync(filename, 'utf8');

  return flow([
    replace(/replace-me-granuleId/g, newGranuleId),
    replace(/replace-me-path/g, newPath),
    replace(/replace-me-collectionId/g, newCollectionId),
    replace(/replace-me-stackId/g, stackId),
    JSON.parse,
  ])(fileContents);
};

const waitForGranuleRecordInOrNotInList = async (stackName, granuleId, granuleIsIncluded = true, additionalQueryParams = {}) => await pWaitFor(
  async () => {
    const resp = await listGranules({
      prefix: stackName,
      query: {
        fields: 'granuleId',
        granuleId,
        ...additionalQueryParams,
      },
    });
    const ids = JSON.parse(resp.body).results.map((g) => g.granuleId);
    return granuleIsIncluded ? ids.includes(granuleId) : !ids.includes(granuleId);
  },
  {
    interval: 10000,
    timeout: 600 * 1000,
  }
);

const waitForGranuleRecordNotInList = async (stackName, granuleId, additionalQueryParams = {}) =>
  await waitForGranuleRecordInOrNotInList(stackName, granuleId, false, additionalQueryParams);

const waitForGranuleRecordsNotInList = async (stackName, granuleIds, additionalQueryParams = {}) => await Promise.all(
  granuleIds.map((id) => waitForGranuleRecordNotInList(stackName, id, additionalQueryParams))
);

const waitForGranuleRecordInList = async (stackName, granuleId, additionalQueryParams = {}) =>
  await waitForGranuleRecordInOrNotInList(stackName, granuleId, true, additionalQueryParams);

const waitForGranuleRecordsInList = async (stackName, granuleIds, additionalQueryParams = {}) => await Promise.all(
  granuleIds.map((id) => waitForGranuleRecordInList(stackName, id, additionalQueryParams))
);

const waitForGranuleRecordUpdatedInList = async (stackName, granule, additionalQueryParams = {}) => await pWaitFor(
  async () => {
    // Ignore the fields generated by CMR. The date string will be in a
    // different ISO format.
    const fieldsIgnored = [
      'beginningDateTime',
      'endingDateTime',
      'error',
      'execution', // TODO remove after CUMULUS-3698
      'files', // TODO -2714 this should be removed
      'lastUpdateDateTime',
      'productionDateTime',
      'updatedAt',
      'timestamp',
    ];

    const resp = await listGranules({
      prefix: stackName,
      query: {
        granuleId: granule.granuleId,
        ...additionalQueryParams,
      },
    });
    const results = JSON.parse(resp.body).results;
    if (results && results.length === 1) {
      // TODO - CUMULUS-2714 key sort both files objects for comparison
      const granuleMatches = isEqual(omit(results[0], fieldsIgnored), omit(granule, fieldsIgnored));

      if (!granuleMatches) {
        const listResult = omit(results[0], fieldsIgnored);
        const getResult = omit(granule, fieldsIgnored);

        console.log('Results from /granules LIST::::', listResult);
        console.log('Result from /granule GET:::', getResult);

        const difference = Object.keys(listResult).filter((k) => getResult[k] !== listResult[k]);
        console.log('Granule GET and LIST responses do not match. Difference::::', difference);
      }

      return granuleMatches;
    }
    return false;
  },
  {
    interval: 10000,
    timeout: 1000 * 1000,
  }
);

const waitForGranuleAndDelete = async (prefix, granuleId, collectionId, status, retryConfig = {}) => {
  await waitForApiStatus(
    getGranule,
    {
      prefix,
      granuleId,
      collectionId,
    },
    status,
    retryConfig
  );
  // clean up stack state added by test
  await deleteGranule({
    prefix,
    granuleId,
    collectionId,
  });
};

module.exports = {
  addUniqueGranuleFilePathToGranuleFiles,
  addUrlPathToGranuleFiles,
  deleteGranules,
  loadFileWithUpdatedGranuleIdPathAndCollection,
  setupTestGranuleForIngest,
  waitForGranuleRecordsInList,
  waitForGranuleRecordsNotInList,
  waitForGranuleRecordUpdatedInList,
  waitForGranuleAndDelete,
};
