'use strict';

const omit = require('lodash/omit');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { waitForListGranulesResult } = require('@cumulus/integration-tests/Granules');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const {
  associateExecutionWithGranule,
  createGranule,
  deleteGranule,
  getGranule,
  updateGranule,
} = require('@cumulus/api-client/granules');
const {
  createExecution,
  deleteExecution,
} = require('@cumulus/api-client/executions');
const { randomId } = require('@cumulus/common/test-utils');
const { removeNilProperties } = require('@cumulus/common/util');
const {
  fakeExecutionFactoryV2,
  fakeGranuleFactoryV2,
} = require('@cumulus/api/lib/testUtils');

const { loadConfig } = require('../../helpers/testUtils');

describe('The Granules API', () => {
  let beforeAllFailed = false;
  let config;
  let collection;
  let collectionId;
  let discoveredGranule;
  let granuleId;
  let prefix;
  let executionRecord;
  let granuleFile;
  let randomGranuleRecord;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;

      collection = await createCollection(prefix);
      collectionId = constructCollectionId(collection.name, collection.version);

      executionRecord = omit(fakeExecutionFactoryV2({
        collectionId,
        status: 'running',
      }), ['parentArn', 'createdAt', 'updatedAt']);

      const response = await createExecution({
        prefix,
        body: executionRecord,
      });

      if (response.statusCode !== 200) {
        throw new Error(`failed to createExecution ${response.body.message}`);
      }

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

      randomGranuleRecord = removeNilProperties(fakeGranuleFactoryV2({
        collectionId,
        published: false,
        dataType: undefined,
        version: undefined,
        execution: undefined,
        files: [granuleFile],
      }));

      granuleId = randomGranuleRecord.granuleId;
    } catch (error) {
      beforeAllFailed = true;
      console.log(error);
    }
  });

  afterAll(async () => {
    await deleteGranule({ prefix, granuleId });
    await deleteExecution({ prefix, executionArn: executionRecord.arn });
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

    it('can discover the granule directly via the API.', async () => {
      discoveredGranule = await getGranule({
        prefix,
        granuleId,
      });
      expect(discoveredGranule).toEqual(jasmine.objectContaining(randomGranuleRecord));
    });

    it('can search the granule via the API.', async () => {
      const searchResults = await waitForListGranulesResult({
        prefix,
        query: {
          granuleId: randomGranuleRecord.granuleId,
        },
      });

      const searchedGranule = JSON.parse(searchResults.body).results[0];
      expect(searchedGranule).toEqual(jasmine.objectContaining(randomGranuleRecord));
    });

    it('can modify the granule via API.', async () => {
      const modifiedGranule = {
        ...discoveredGranule,
        status: 'failed',
        error: { message: 'granule now failed' },
      };
      const response = await updateGranule({
        prefix,
        body: modifiedGranule,
      });

      expect(response.statusCode).toBe(200);
      const updatedGranuleFromApi = await getGranule({
        prefix,
        granuleId: modifiedGranule.granuleId,
      });
      updatedGranuleFromApi.execution = undefined;
      expect(updatedGranuleFromApi).toEqual(jasmine.objectContaining(modifiedGranule));
    });

    it('can associate an execution with the granule via API.', async () => {
      const requestPayload = {
        granuleId,
        collectionId,
        executionArn: executionRecord.arn,
      };
      const response = await associateExecutionWithGranule({
        prefix,
        body: requestPayload,
      });

      expect(response.statusCode).toBe(200);
      const updatedGranuleFromApi = await getGranule({
        prefix,
        granuleId,
      });
      expect(updatedGranuleFromApi.execution).toBe(executionRecord.execution);
    });

    it('Errors creating a bad granule.', async () => {
      const name = randomId('name');
      const version = randomId('version');
      const badRandomGranuleRecord = fakeGranuleFactoryV2({
        collectionId: constructCollectionId(name, version),
        execution: undefined,
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
