'use strict';

const path = require('path');
const { addProviders, addCollections } = require('@cumulus/integration-tests');
const { s3 } = require('@cumulus/common/aws');
const { loadConfig } = require('../helpers/testUtils');
const fs = require('fs-extra');
const config = loadConfig();

const collectionsDirectory = './data/collections';
const providersDirectory = './data/providers';

const s3data = [
  '@cumulus/test-data/pdrs/MOD09GQ_1granule_v3.PDR',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
];

/**
 * Upload a file from the test-data package to the S3 test data
 *
 * @param {string} file - filename of data to upload
 * @param {string} bucket - bucket to upload to
 * @returns {Promise<Object>} - promise returned from S3 PUT
 */
async function uploadTestDataToS3(file, bucket) {
  const data = await fs.readFile(require.resolve(file), 'utf8');

  // Pull out just the file name from the path and use as the key
  const key = file.replace(/^.*[\\\/]/, '');;

  return s3().putObject({
    Bucket: bucket,
    Key: `cumulus-test-data/pdrs/${key}`,
    Body: data
  }).promise();
}


/**
 * For each unique S3 provider bucket, upload the test data
 *
 * @param {Array<Object>} providers - array of providers
 * @returns {Promise<Object>} - promise resolved when all the S3
 * PUT promises resolve
 */
async function populateS3ProviderTestData(providers) {
  const promises = [];

  const buckets = providers
    .filter((p) => p.protocol === 's3')
    .map((prov) => prov.host);

  const uniqueBuckets = Array.from(new Set(buckets));

  uniqueBuckets.forEach((bucket) =>
    s3data.forEach((file) =>
      promises.push(uploadTestDataToS3(file, bucket))));

  return Promise.all(promises);
}

describe('Populating providers and collections to database', () => {
  let collections;
  let providers;
  beforeAll(async () => {
    try {
      collections = await addCollections(config.stackName, config.bucket, collectionsDirectory);
      providers = await addProviders(config.stackName, config.bucket, providersDirectory);

      await populateS3ProviderTestData(providers);
    }
    catch (e) {
      console.log(e);
      throw e;
    }
  });

  it('providers and collections are added successfully', async () => {
    expect(collections.length >= 1).toBe(true);
    expect(providers.length >= 1).toBe(true);
  });
});
