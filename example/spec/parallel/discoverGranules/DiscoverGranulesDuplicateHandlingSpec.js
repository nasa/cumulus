'use strict';

const cryptoRandomString = require('crypto-random-string');
const delay = require('delay');
const pMap = require('p-map');
const { deleteS3Files, s3PutObject } = require('@cumulus/aws-client/S3');

const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { createCollection, deleteCollection } = require('@cumulus/api-client/collections');
const { deleteRule, postRule } = require('@cumulus/api-client/rules');
const { createProvider, deleteProvider } = require('@cumulus/api-client/providers');
const {
  deleteGranule,
  waitForCompletedGranule
} = require('@cumulus/api-client/granules');

const {
  api: apiTestUtils,
  addCollections,
  buildAndExecuteWorkflow,
  cleanupCollections,
  waitForCompletedExecution
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix
} = require('../../helpers/testUtils');

const { buildHttpProvider } = require('../../helpers/Providers');

const randomId = (prefix, separator = '-') =>
  `${prefix}${separator}${cryptoRandomString({ length: 6 })}`;

describe('The Discover Granules workflow', () => {
  // const collectionsDir = './data/collections/http_testcollection_002/';
  // const expectedGranuleIds = ['granule-4', 'granule-5', 'granule-6'];

  let beforeAllFailed = false;
  let collection;
  let config;
  let lambdaStep;
  let provider;
  let testId;
  let testSuffix;
  let granule1Key;
  let ingestRule;
  let prefix;
  let granule1Id;
  let granule2Id;
  let granule2Key;
  let discoverRule;

  beforeAll(async () => {
    // lambdaStep = new LambdaStep();
    config = await loadConfig();
    prefix = config.stackName;

    testId = randomId('test');

    // testId = createTimestampedTestId(config.stackName, 'DiscoverGranulesDuplicate');
    // testSuffix = createTestSuffix(testId);
    // collection = { name: `http_testcollection${testSuffix}`, version: '002' };
    // provider = await buildHttpProvider(testSuffix);

    // await Promise.all([
    //   addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
    //   createProvider(config.stackName, provider)
    // ]);

    // collection = JSON.parse((await apiTestUtils.getCollection({
    //   prefix: config.stackName,
    //   collectionName: collection.name,
    //   collectionVersion: collection.version
    // })).body);

    // TODO In all of the API calls, if we get something other than a 200 response, throw an error
    // TODO In the cleanup, handle "does not exist" errors
    // TODO Move cleanup into the BeforeAll block

    const sourceKeyPath = `${prefix}/tmp/${testId}`;

    try {
      // Create a collection configured to skip duplicates
      collection = {
        name: randomId('collection-name'),
        version: randomId('collection-version'),
        duplicateHandling: 'skip',
        reportToEms: false,
        granuleId: '^[^.]+$',
        granuleIdExtraction: '^([^.]+)\..+$',
        sampleFileName: 'asdf.jpg',
        provider_path: `${sourceKeyPath}/`,
        files: [
          {
            bucket: 'protected',
            regex: '^[^.]+\..+$',
            sampleFileName: 'asdf.jpg'
          }
        ]
      };

      console.time('create collection');
      const createCollectionResponse = await createCollection({ prefix, collection });
      console.timeEnd('create collection');
      if (![200, 404].includes(createCollectionResponse.statusCode)) {
        throw new Error(`Failed to create collection: ${JSON.stringify(createCollectionResponse)}`);
      }

      provider = {
        id: randomId('provider'),
        globalConnectionLimit: 10,
        protocol: 's3',
        host: config.bucket
      };

      console.time('create provider');
      const createProviderResponse = await createProvider({ prefix, provider });
      console.timeEnd('create provider');
      if (![200, 404].includes(createProviderResponse.statusCode)) {
        throw new Error(`Failed to create provider: ${JSON.stringify(createProviderResponse)}`);
      }

      // Stage granule-1
      granule1Id = randomId('granule-1');
      granule1Key = `${sourceKeyPath}/${granule1Id}.txt`;
      await s3PutObject({
        Bucket: config.bucket,
        Key: granule1Key,
        Body: 'asdf'
      });

      // Create a 1-time rule to ingest the granule
      ingestRule = {
        name: randomId('rule', '_'),
        workflow: 'IngestGranule',
        collection: {
          name: collection.name,
          version: collection.version
        },
        provider: provider.id,
        rule: {
          type: 'onetime'
        },
        payload: {
          granules: [
            {
              granuleId: granule1Id,
              dataType: collection.name,
              version: collection.version,
              files: [
                {
                  name: `${granule1Id}.txt`,
                  path: sourceKeyPath
                }
              ]
            }
          ]
        }
      };

      console.time('create ingest rule');
      const postIngestRuleResponse = await postRule({ prefix, rule: ingestRule });
      console.timeEnd('create ingest rule');
      if (![200, 404].includes(postIngestRuleResponse.statusCode)) {
        throw new Error(`Failed to create ingest rule: ${JSON.stringify(postIngestRuleResponse)}`);
      }

      // TODO Wait for the rule to exist in the DB
      // TODO Delete the rule

      // Wait for the first granule to exist in the database
      console.time('wait for completed granule 1');
      await waitForCompletedGranule({ prefix, granuleId: granule1Id });
      console.timeEnd('wait for completed granule 1');

      // Stage granule-2
      granule2Id = randomId('granule-2');
      granule2Key = `${sourceKeyPath}/${granule2Id}.txt`;
      await s3PutObject({
        Bucket: config.bucket,
        Key: granule2Key,
        Body: 'asdf'
      });

      // Create a 1-time rule to discover the granules
      discoverRule = {
        name: randomId('rule', '_'),
        workflow: 'DiscoverGranules',
        collection: {
          name: collection.name,
          version: collection.version
        },
        provider: provider.id,
        rule: {
          type: 'onetime'
        }
      };

      console.time('create discover rule');
      const postDiscoverRuleResponse = await postRule({ prefix, rule: discoverRule });
      console.timeEnd('create discover rule');
      if (![200, 404].includes(postDiscoverRuleResponse.statusCode)) {
        throw new Error(`Failed to create discover rule: ${JSON.stringify(postDiscoverRuleResponse)}`);
      }
      // TODO Wait for the rule to exist in the database
      // TODO Delete the rule

      // TODO Wait for granule-2 to be in the `completed` state

      // TODO HOW DO WE GET THE EXECUTION ARN FOR A ONE-TIME RULE?


    } catch (err) {
      beforeAllFailed = true;
      console.error(err);
      throw err;
    }
  });

  afterAll(async () => {
    // TODO Make sure this works if the files don't exist
    console.time('delete S3 objects');
    // await deleteS3Files([
    //   { Bucket: config.bucket, Key: granule1Key },
    //   { Bucket: config.bucket, Key: granule2Key }
    // ]);
    console.timeEnd('delete S3 objects');

    console.time('delete ingest rule');
    const deleteIngestRuleResponse = await deleteRule({
      prefix,
      ruleName: ingestRule.name
    });
    console.timeEnd('delete ingest rule');
    if (![200, 404].includes(deleteIngestRuleResponse.statusCode)) {
      console.log('deleteRuleResponse:', JSON.stringify(deleteIngestRuleResponse, null, 2));
    }

    console.time('delete discover rule');
    const deleteDiscoverRuleResponse = await deleteRule({
      prefix,
      ruleName: discoverRule.name
    });
    console.timeEnd('delete discover rule');
    if (![200, 404].includes(deleteDiscoverRuleResponse.statusCode)) {
      console.log('deleteDiscoverRuleResponse:', JSON.stringify(deleteDiscoverRuleResponse, null, 2));
    }

    console.time('delete provider');
    const deleteProviderResponse = await deleteProvider({
      prefix,
      providerId: provider.id
    });
    console.timeEnd('delete provider');
    if (![200, 404].includes(deleteProviderResponse.statusCode)) {
      console.log('deleteProviderResponse:', JSON.stringify(deleteProviderResponse, null, 2));
    }

    console.time('delete granule 1');
    const deleteGranuleResponse = await deleteGranule({
      prefix, granuleId: granule1Id
    });
    console.timeEnd('delete granule 1');
    if (![200, 404].includes(deleteGranuleResponse.statusCode)) {
      console.log('deleteGranuleResponse:', JSON.stringify(deleteGranuleResponse, null, 2));
    }

    // Must be done _after_ deleting rules
    console.time('delete collection');
    const deleteCollectionResponse = await deleteCollection({
      prefix,
      collectionName: collection.name,
      collectionVersion: collection.version
    });
    console.timeEnd('delete collection');
    if (![200, 404].includes(deleteCollectionResponse.statusCode)) {
      console.log('deleteCollectionResponse:', JSON.stringify(deleteCollectionResponse, null, 2));
    }

    // TODO Delete the 1-time rule

    // await Promise.all([
    //   cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
    //   deleteProvider({ prefix: config.stackName, providerId: provider.id })
    // ]);

    // await pMap(
    //   expectedGranuleIds,
    //   (granuleId) => deleteGranule({ prefix: config.stackName, granuleId })
    // );

    // TODO Delete the created collection
  });

  it('blah', () => {
    if (beforeAllFailed) fail('BeforeAll failed');
    else {
      expect(true).toBeTrue();
    }
  });

  // describe('when the collection configured with duplicateHandling set to "skip" it:', () => {
  //   let ingestStatus;
  //   let httpWorkflowExecution;
  //   let originalHttpWorkflowExecution;

  //   beforeAll(async () => {
  //     await updateCollectionDuplicateFlag('replace', collection, config);

  //     originalHttpWorkflowExecution = await buildAndExecuteWorkflow(config.stackName,
  //       config.bucket, 'DiscoverGranules', collection, provider);

  //     ingestStatus = await awaitIngestExecutions(originalHttpWorkflowExecution, lambdaStep);

  //     // Wait for all of the ingested granules to reach the `completed` state
  //     await pMap(
  //       expectedGranuleIds,
  //       (granuleId) => waitForCompletedGranule({
  //         granuleId,
  //         prefix: config.stackName
  //       })
  //     );

  //     await deleteGranule({ prefix: config.stackName, granuleId: 'granule-4' });
  //     await updateCollectionDuplicateFlag('skip', collection, config);

  //     httpWorkflowExecution = await buildAndExecuteWorkflow(config.stackName,
  //       config.bucket, 'DiscoverGranules', collection, provider);
  //   });

  //   it('executes initial ingest successfully', () => {
  //     expect(originalHttpWorkflowExecution.status).toEqual('SUCCEEDED');
  //     expect(ingestStatus.every((e) => e === 'SUCCEEDED')).toEqual(true);
  //   });

  //   it('recieves an event with duplicateHandling set to skip', async () => {
  //     const lambdaInput = await lambdaStep.getStepInput(
  //       httpWorkflowExecution.executionArn, 'DiscoverGranules'
  //     );
  //     expect(lambdaInput.meta.collection.duplicateHandling).toEqual('skip');
  //   });

  //   it('executes successfully', () => {
  //     expect(httpWorkflowExecution.status).toEqual('SUCCEEDED');
  //   });

  //   it('discovers granules, but skips the granules as duplicates', async () => {
  //     const lambdaOutput = await lambdaStep.getStepOutput(
  //       httpWorkflowExecution.executionArn, 'DiscoverGranules'
  //     );
  //     expect(lambdaOutput.payload.granules.length).toEqual(1);
  //   });

  //   it('queues only one granule', async () => {
  //     const lambdaOutput = await lambdaStep.getStepOutput(
  //       httpWorkflowExecution.executionArn, 'QueueGranules'
  //     );
  //     expect(lambdaOutput.payload.running.length).toEqual(1);
  //   });
  // });

  // describe('when the collection configured with duplicateHandling set to "error" it:', () => {
  //   let ingestStatus;
  //   let httpWorkflowExecution;
  //   let originalHttpWorkflowExecution;

  //   beforeAll(async () => {
  //     await updateCollectionDuplicateFlag('replace', collection, config);

  //     originalHttpWorkflowExecution = await buildAndExecuteWorkflow(config.stackName,
  //       config.bucket, 'DiscoverGranules', collection, provider);

  //     ingestStatus = await awaitIngestExecutions(originalHttpWorkflowExecution, lambdaStep);

  //     // Wait for all of the ingested granules to reach the `completed` state
  //     await pMap(
  //       expectedGranuleIds,
  //       (granuleId) => waitForCompletedGranule({
  //         granuleId,
  //         prefix: config.stackName
  //       })
  //     );

  //     await updateCollectionDuplicateFlag('error', collection, config);

  //     httpWorkflowExecution = await buildAndExecuteWorkflow(config.stackName,
  //       config.bucket, 'DiscoverGranules', collection, provider);
  //   });

  //   it('executes initial ingest successfully', () => {
  //     expect(originalHttpWorkflowExecution.status).toEqual('SUCCEEDED');
  //     expect(ingestStatus.every((e) => e === 'SUCCEEDED')).toEqual(true);
  //   });

  //   it('recieves an event with duplicateHandling set to error', async () => {
  //     const lambdaInput = await lambdaStep.getStepInput(
  //       httpWorkflowExecution.executionArn, 'DiscoverGranules'
  //     );
  //     expect(lambdaInput.meta.collection.duplicateHandling).toEqual('error');
  //   });

  //   it('fails', () => {
  //     expect(httpWorkflowExecution.status).toEqual('FAILED');
  //   });

  //   it('has the expected error', async () => {
  //     const lambdaOutput = await lambdaStep.getStepOutput(
  //       httpWorkflowExecution.executionArn, 'DiscoverGranules', 'failure'
  //     );
  //     const expectedSubString = 'Duplicate granule found';
  //     expect(JSON.parse(lambdaOutput.cause).errorMessage).toContain(expectedSubString);
  //   });
  // });
});
