'use strict';

const { addProviders, addCollections } = require('@cumulus/integration-tests');
const { s3 } = require('@cumulus/common/aws');
const { loadConfig } = require('../helpers/testUtils');
const fs = require('fs-extra');
const config = loadConfig();

const collectionsDirectory = './data/collections';
const providersDirectory = './data/providers';

/**
 * Custom require to get the files from test data for upload to S3
 *
 * @param {Object} module - module
 * @param {string} filename - filename
 * @returns {undefined} - none
 */
function requireAsText(module, filename) {
  module.exports = fs.readFileSync(filename, 'utf8'); // eslint-disable-line no-param-reassign
}

require.extensions['.PDR'] = requireAsText;
require.extensions['.met'] = requireAsText;
require.extensions['.hdf'] = requireAsText;
require.extensions['.jpg'] = requireAsText;

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
  const key = file.replace(/^.*[\\\/]/, '');
  const data = require(file);

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

  const buckets = providers.filter((p) => p.protocol === 's3')
    .map((prov) => prov.host);

  const uniqueBuckets = [...new Set(buckets)];

  uniqueBuckets.map((b) =>
    s3data.map((file) =>
      promises.push(uploadTestDataToS3(file, b))));

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
