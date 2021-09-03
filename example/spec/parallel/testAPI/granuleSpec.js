'use strict';

const { s3PutObject } = require('@cumulus/aws-client/S3');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  buildRandomizedGranule,
} = require('@cumulus/integration-tests/Granules');
const { deleteCollection } = require('@cumulus/api-client/collections');
const {
  createGranule,
  deleteGranule,
  getGranule,
} = require('@cumulus/api-client/granules');
const { randomId } = require('@cumulus/common/test-utils');
const { loadConfig } = require('../../helpers/testUtils');

describe('The Granules API', () => {
  let beforeAllFailed = false;
  let config;
  let collection;
  let collectionId;
  let granuleId;
  let prefix;
  let granuleFile;
  let randomGranuleRecord;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;

      collection = await createCollection(prefix);
      collectionId = constructCollectionId(collection.name, collection.version);

      granuleFile = {
        bucket: config.buckets.public.name,
        key: randomId('key'),
        size: 8,
      };
      await s3PutObject({
        Bucket: granuleFile.bucket,
        Key: granuleFile.key,
        Body: 'testfile',
      });

      randomGranuleRecord = buildRandomizedGranule({
        collectionId,
        files: [granuleFile],
      });
      granuleId = randomGranuleRecord.granuleId;
    } catch (error) {
      beforeAllFailed = true;
      console.log(error);
    }
  });

  afterAll(async () => {
    await deleteGranule({ prefix, granuleId });
    await deleteCollection({
      prefix,
      collectionName: collection.name,
      collectionVersion: collection.version,
    });
  });

  describe('the Granule Api', () => {
    it('creates a granule.', async () => {
      if (beforeAllFailed) {
        fail('beforeAll() failed');
      } else {
        const response = await createGranule({
          prefix,
          body: randomGranuleRecord,
        });

        expect(response.statusCode).toBe(200);
        const { message } = JSON.parse(response.body);
        expect(message).toBe(`Successfully wrote granule with Granule Id: ${granuleId}`);
      }
    });

    it('can discover the granule in the API.', async () => {
      const granule = await getGranule({
        prefix,
        granuleId,
      });
      expect(granule).toEqual(jasmine.objectContaining(randomGranuleRecord));
    });

    it('Errors creating a bad granule.', async () => {
      const name = randomId('name');
      const version = randomId('version');
      const badRandomGranuleRecord = buildRandomizedGranule({
        collectionId: constructCollectionId(name, version),
      });
      try {
        await createGranule({
          prefix,
          body: badRandomGranuleRecord,
        });
      } catch (error) {
        const apiError = JSON.parse(error.apiMessage);
        expect(apiError.statusCode).toBe(400);
        expect(apiError.error).toBe('Bad Request');
        expect(apiError.message).toContain('RecordDoesNotExist');
        expect(apiError.message).toContain(name);
        expect(apiError.message).toContain(version);
      }
    });
  });
});
