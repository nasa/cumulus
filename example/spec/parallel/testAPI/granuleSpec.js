'use strict';

const omit = require('lodash/omit');
const {
  s3PutObject,
  getJsonS3Object,
  waitForObjectToExist,
} = require('@cumulus/aws-client/S3');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { waitForListGranulesResult, getGranuleWithStatus } = require('@cumulus/integration-tests/Granules');
const { deleteCollection } = require('@cumulus/api-client/collections');
const {
  associateExecutionWithGranule,
  createGranule,
  deleteGranule,
  getGranule,
  replaceGranule,
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
const { constructCollectionId } = require('@cumulus/message/Collections');

const { loadConfig } = require('../../helpers/testUtils');

describe('The Granules API', () => {
  let beforeAllError;
  let config;
  let collection1;
  let collection2;
  let collection3;
  let collection4;
  let collection5;
  let collectionId;
  let discoveredGranule;
  let executionRecord;
  let granule1;
  let granuleFile;
  let granuleId;
  let modifiedGranule;
  let invalidModifiedGranule;
  let prefix;
  let putReplaceGranule;
  let randomGranuleRecord;
  let updatedGranuleFromApi;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;

      collection1 = await createCollection(prefix);
      collectionId = constructCollectionId(collection1.name, collection1.version);

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

      putReplaceGranule = removeNilProperties(fakeGranuleFactoryV2({
        collectionId: collectionId,
        published: false,
        execution: undefined,
        files: [granuleFile],
        status: 'completed',
      }));

      randomGranuleRecord = removeNilProperties(fakeGranuleFactoryV2({
        collectionId,
        published: false,
        dataType: undefined,
        version: undefined,
        execution: undefined,
        files: [granuleFile],
      }));
      console.log('granule record: %j', randomGranuleRecord);

      granuleId = randomGranuleRecord.granuleId;
    } catch (error) {
      beforeAllError = error;
    }
  });

  afterAll(async () => {
    await deleteExecution({ prefix, executionArn: executionRecord.arn });
    await deleteGranule({ prefix, granuleId: granule1.granuleId, collectionId: granule1.collectionId });
    await deleteGranule({ prefix, granuleId: invalidModifiedGranule.granuleId, collectionId: invalidModifiedGranule.collectionId });
    await deleteGranule({ prefix, granuleId: putReplaceGranule.granuleId, collectionId: putReplaceGranule.collectionId });

    await deleteCollection({
      prefix,
      collectionName: collection1.name,
      collectionVersion: collection1.version,
    });
    await deleteCollection({
      prefix,
      collectionName: collection2.name,
      collectionVersion: collection2.version,
    });
    await deleteCollection({
      prefix,
      collectionName: collection3.name,
      collectionVersion: collection3.version,
    });
    await deleteCollection({
      prefix,
      collectionName: collection4.name,
      collectionVersion: collection4.version,
    });
    await deleteCollection({
      prefix,
      collectionName: collection5.name,
      collectionVersion: collection5.version,
    });
  });

  describe('the Granule Api', () => {
    it('creates a granule.', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }
      const response = await createGranule({
        prefix,
        body: randomGranuleRecord,
      });

      expect(response.statusCode).toBe(200);
      const { message } = JSON.parse(response.body);
      expect(message).toBe(`Successfully wrote granule with Granule Id: ${granuleId}, Collection Id: ${collectionId}`);
    });

    it('can discover the granule directly via the API.', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }

      discoveredGranule = await getGranule({
        prefix,
        granuleId,
        collectionId,
      });
      expect(discoveredGranule).toEqual(jasmine.objectContaining(randomGranuleRecord));
    });

    it('can search the granule via the API.', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }

      const searchResults = await waitForListGranulesResult({
        prefix,
        query: {
          granuleId: randomGranuleRecord.granuleId,
        },
      });

      const searchedGranule = JSON.parse(searchResults.body).results[0];
      expect(searchedGranule).toEqual(jasmine.objectContaining({
        ...randomGranuleRecord,
        files: []
      }));
    });
    it('can search the granule including files via the API.', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }

      const searchResults = await waitForListGranulesResult({
        prefix,
        query: {
          granuleId: randomGranuleRecord.granuleId,
          includeFullRecord: 'true',
        },
      });

      const searchedGranule = JSON.parse(searchResults.body).results[0];
      expect(searchedGranule).toEqual(jasmine.objectContaining(randomGranuleRecord));
    });

    it('can modify the granule via API.', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }

      modifiedGranule = {
        ...discoveredGranule,
        status: 'failed',
        error: { message: 'granule now failed' },
      };
      const response = await updateGranule({
        prefix,
        granuleId: modifiedGranule.granuleId,
        collectionId: modifiedGranule.collectionId,
        body: modifiedGranule,
      });

      expect(response.statusCode).toBe(200);
      updatedGranuleFromApi = await getGranule({
        prefix,
        granuleId: modifiedGranule.granuleId,
        collectionId: modifiedGranule.collectionId,
      });
      updatedGranuleFromApi.execution = undefined;
      expect(updatedGranuleFromApi).toEqual(jasmine.objectContaining(modifiedGranule));
    });

    it('can associate an execution with the granule via API.', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }

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
      updatedGranuleFromApi = await getGranule({
        prefix,
        granuleId,
        collectionId,
      });
      expect(updatedGranuleFromApi.execution).toBe(executionRecord.execution);
    });

    it('Errors creating a bad granule.', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }

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

    it('publishes a record to the granules reporting SNS topic upon granule creation', async () => {
      if (beforeAllError) {
        fail('beforeAll() failed');
      } else {
        const granuleKey = `${config.stackName}/test-output/${granuleId}-${discoveredGranule.status}-Create.output`;
        await expectAsync(waitForObjectToExist({
          bucket: config.bucket,
          key: granuleKey,
        })).toBeResolved();
        const savedEvent = await getJsonS3Object(config.bucket, granuleKey);
        const message = JSON.parse(savedEvent.Records[0].Sns.Message);
        expect(message.event).toEqual('Create');
        expect(message.record).toEqual(discoveredGranule);
      }
    });

    it('publishes a record to the granules reporting SNS topic for a granule modification', async () => {
      if (beforeAllError) {
        fail('beforeAll() failed');
      } else {
        const granuleKey = `${config.stackName}/test-output/${modifiedGranule.granuleId}-${modifiedGranule.status}-Update.output`;
        await expectAsync(waitForObjectToExist({
          bucket: config.bucket,
          key: granuleKey,
        })).toBeResolved();
        const savedEvent = await getJsonS3Object(config.bucket, granuleKey);
        const message = JSON.parse(savedEvent.Records[0].Sns.Message);
        expect(message.event).toEqual('Update');
        expect(message.record).toEqual(updatedGranuleFromApi);
      }
    });

    it('publishes a record to the granules reporting SNS topic for a granule deletion', async () => {
      if (beforeAllError) {
        fail('beforeAll() failed');
      } else {
        const timestamp = Date.now();
        const response = await deleteGranule({ prefix, granuleId: modifiedGranule.granuleId, collectionId: modifiedGranule.collectionId });
        expect(response.statusCode).toBe(200);

        const granuleKey = `${config.stackName}/test-output/${modifiedGranule.granuleId}-${modifiedGranule.status}-Delete.output`;
        await expectAsync(waitForObjectToExist({
          bucket: config.bucket,
          key: granuleKey,
        })).toBeResolved();
        const savedEvent = await getJsonS3Object(config.bucket, granuleKey);
        const message = JSON.parse(savedEvent.Records[0].Sns.Message);
        expect(message.event).toEqual('Delete');
        expect(message.record).toEqual(updatedGranuleFromApi);
        expect(message.deletedAt).toBeGreaterThan(timestamp);
      }
    });

    it('errors creating a granule that already exists across a different collection', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }
      collection2 = await createCollection(prefix);
      const newCollectionId = constructCollectionId(collection2.name, collection2.version);
      granule1 = removeNilProperties(fakeGranuleFactoryV2({
        collectionId: newCollectionId,
        published: false,
        execution: undefined,
        files: [granuleFile],
      }));
      const response = await createGranule({
        prefix,
        body: granule1,
      });
      collection3 = await createCollection(prefix);
      const diffCollectionId = constructCollectionId(collection3.name, collection3.version);
      const granuleWithDiffCollection = {
        ...granule1,
        collectionId: diffCollectionId,
      };

      expect(response.statusCode).toBe(200);
      try {
        await createGranule({
          prefix,
          body: granuleWithDiffCollection,
        });
      } catch (error) {
        const apiError = JSON.parse(error.apiMessage);
        expect(apiError.statusCode).toBe(409);
        expect(apiError.error).toBe('Conflict');
        expect(apiError.message).toContain('A granule already exists for granuleId');
        expect(apiError.message).toContain(granuleWithDiffCollection.granuleId);
      }
    });

    it('errors updating a granule that already exists across a different collection', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }
      collection4 = await createCollection(prefix);
      const newCollectionId = constructCollectionId(collection4.name, collection4.version);
      invalidModifiedGranule = removeNilProperties(fakeGranuleFactoryV2({
        collectionId: newCollectionId,
        published: false,
        execution: undefined,
        files: [granuleFile],
      }));
      const response = await createGranule({
        prefix,
        body: invalidModifiedGranule,
      });
      collection5 = await createCollection(prefix);
      const diffCollectionId = constructCollectionId(collection5.name, collection5.version);
      const granuleWithDiffCollection = {
        ...invalidModifiedGranule,
        collectionId: diffCollectionId,
      };

      expect(response.statusCode).toBe(200);
      try {
        await updateGranule({
          prefix,
          granuleId: granuleWithDiffCollection.granuleId,
          collectionId: granuleWithDiffCollection.collectionId,
          body: granuleWithDiffCollection,
        });
      } catch (error) {
        const apiError = JSON.parse(error.apiMessage);
        expect(apiError.statusCode).toBe(409);
        expect(apiError.error).toBe('Conflict');
        expect(apiError.message).toContain('Modifying collectionId for a granule is not allowed');
        expect(apiError.message).toContain(granuleWithDiffCollection.granuleId);
      }
    });

    it('replaces a granule, removing all applicable fields not provided', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }
      const createResponse = await createGranule({
        prefix,
        body: putReplaceGranule,
      });
      expect(createResponse.statusCode).toBe(200);

      const replacementGranule = {
        granuleId: putReplaceGranule.granuleId,
        collectionId,
        status: 'failed',
      };
      const replaceResponse = await replaceGranule({
        prefix,
        body: replacementGranule,
      });
      expect(replaceResponse.statusCode).toBe(200);
      const searchResults = await getGranuleWithStatus({
        prefix,
        granuleId: replacementGranule.granuleId,
        collectionId,
        status: 'failed',
      });

      const replacementGranuleWithDefaultsFilled = {
        ...replacementGranule,
        files: [],
        error: {},
        published: false,
        timestamp: searchResults.timestamp,
        updatedAt: searchResults.updatedAt,
        createdAt: searchResults.createdAt,
      };

      expect(searchResults).toEqual(replacementGranuleWithDefaultsFilled);
    });
  });
});
