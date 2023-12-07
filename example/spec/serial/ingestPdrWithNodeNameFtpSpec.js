'use strict';

/**
 * End to end ingest from discovering and ingesting a PDR that specifies a
 * granule's provider using NODE_NAME with a provider that utilizes login credentials
 */

const S3 = require('@cumulus/aws-client/S3');
const { s3, lambda } = require('@cumulus/aws-client/services');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { providers: providersApi } = require('@cumulus/api-client');
const { randomString } = require('@cumulus/common/test-utils');
const { deleteExecution, getExecution } = require('@cumulus/api-client/executions');
const { deleteGranule, getGranule } = require('@cumulus/api-client/granules');
const { getPdr } = require('@cumulus/api-client/pdrs');

const {
  addCollections,
  addProviders,
  api: apiTestUtils,
  cleanupProviders,
  cleanupCollections,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');

const { buildFtpProvider } = require('../helpers/Providers');
const { encodedConstructCollectionId } = require('../helpers/Collections');
const { buildAndExecuteWorkflow } = require('../helpers/workflowUtils');
const {
  createTestDataPath,
  createTestSuffix,
  createTimestampedTestId,
  deleteFolder,
  getExecutionUrl,
  loadConfig,
  updateAndUploadTestDataToBucket,
} = require('../helpers/testUtils');

const {
  loadFileWithUpdatedGranuleIdPathAndCollection,
} = require('../helpers/granuleUtils');

const { waitForApiStatus } = require('../helpers/apiUtils');
const { deleteProvidersAndAllDependenciesByHost, waitForProviderRecordInOrNotInList } = require('../helpers/Providers');

const lambdaStep = new LambdaStep();
const workflowName = 'DiscoverAndQueuePdrs';
const origPdrFilename = 'MOD09GQ_1granule_v3_with_NODE_NAME.PDR';

const s3data = [
  '@cumulus/test-data/pdrs/MOD09GQ_1granule_v3_with_NODE_NAME.PDR',
];

describe('Ingesting from PDR', () => {
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  let addedCollection;
  let beforeAllFailed;
  let config;
  let nodeNameProviderId;
  let parsePdrExecutionArn;
  let pdrFilename;
  let provider;
  let testDataFolder;
  let testDataGranuleId;
  let testSuffix;
  let workflowExecution;
  let functionName;
  let testFilePaths;

  const ingestTime = Date.now() - 1000 * 30;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      functionName = `${config.stackName}-populateTestLambda`;

      const testId = createTimestampedTestId(config.stackName, 'IngestFromPdrWithNodeName');
      testSuffix = createTestSuffix(testId);
      pdrFilename = `${testSuffix.slice(1)}_${origPdrFilename}`;
      provider = { id: `s3_provider${testSuffix}` };
      testDataFolder = createTestDataPath(testId);
      console.log('line 84');
      const ftpProvider = await buildFtpProvider(`${randomString(4)}-${testSuffix}`);
      await deleteProvidersAndAllDependenciesByHost(config.stackName, config.pdrNodeNameProviderBucket);
      await deleteProvidersAndAllDependenciesByHost(config.stackName, ftpProvider.host);

      nodeNameProviderId = `provider-${randomString(4)}-${testSuffix}`;
      console.log('about to create provider');
      const resp = await providersApi.createProvider({
        prefix: config.stackName,
        provider: {
          id: nodeNameProviderId,
          protocol: 's3',
          host: config.pdrNodeNameProviderBucket,
        },
      });

      console.log('createProvider response::::', resp);

      // Create FTP provider
      await providersApi.createProvider({
        prefix: config.stackName,
        provider: ftpProvider,
      });
      console.log('line 107');

      const providerPromises = await Promise.all([
        waitForProviderRecordInOrNotInList(config.stackName, nodeNameProviderId, true, { timestamp__from: ingestTime }),
        waitForProviderRecordInOrNotInList(config.stackName, ftpProvider.id, true, { timestamp__from: ingestTime }),
      ]);

      console.log('providerPromises::::', providerPromises);

      let testData;
      try {
        testData = await lambda().invoke({
          FunctionName: functionName,
          Payload: new TextEncoder().encode(JSON.stringify({
            prefix: config.stackName,
          })),
        });
      } catch (error) {
        console.log(error);
      }
      console.log('line 127');
      console.log('testData::::', testData);

      const { newGranuleId, filePaths } = JSON.parse(new TextDecoder('utf-8').decode(testData.Payload));
      console.log('payload:::', JSON.parse(new TextDecoder('utf-8').decode(testData.Payload));
      console.log('newGranuleId:::', newGranuleId);
      console.log('filePaths:::', filePaths);
      if (!newGranuleId || !filePaths) {
        console.log('line 135');
        throw new Error('FTP Server setup failed', testData);
      }

      console.log('line 135');
      testFilePaths = filePaths;
      const bucketResp = await updateAndUploadTestDataToBucket(
        config.bucket,
        s3data,
        testDataFolder,
        [
          { old: '21708', new: '10' },
          { old: '1098034', new: '10' },
          { old: 'cumulus-test-data/pdrs', new: config.stackName },
          { old: 'DATA_TYPE = MOD09GQ;', new: `DATA_TYPE = MOD09GQ${testSuffix};` },
          { old: 'XXX_NODE_NAME_XXX', new: ftpProvider.host },
          { old: 'MOD09GQ.A2016358.h13v04.006.2016360104606', new: newGranuleId },
        ]
      );
      console.log('bucketResp:::', bucketResp);
      console.log('line 141::::'); // not getting here
      // populate collections, providers and test data
      const populatePromises = await Promise.all([
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId),
        addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix),
      ]);

      addedCollection = populatePromises[0][0];
      if (addedCollection === undefined) {
        console.log('populatePromises %j', populatePromises);
      }

      // Rename the PDR to avoid race conditions
      await s3().copyObject({
        Bucket: config.bucket,
        CopySource: `${config.bucket}/${testDataFolder}/${origPdrFilename}`,
        Key: `${testDataFolder}/${pdrFilename}`,
      });

      await S3.deleteS3Object(config.bucket, `${testDataFolder}/${origPdrFilename}`);
    } catch (error) {
      beforeAllFailed = true;
      console.log('beforeAll setup error %j', error);
      throw error;
    }
  });

  afterAll(async () => {
    console.log(testFilePaths);
    // clean up stack state added by test
    await apiTestUtils.deletePdr({
      prefix: config.stackName,
      pdr: pdrFilename,
    });

    // The order of execution deletes matters. Parents must be deleted before children.
    await deleteExecution({ prefix: config.stackName, executionArn: parsePdrExecutionArn });
    await deleteExecution({ prefix: config.stackName, executionArn: workflowExecution.executionArn });

    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
    ]).catch(console.error);

    await providersApi.deleteProvider({
      prefix: config.stackName,
      providerId: nodeNameProviderId,
    }).catch(console.error);
    // TODO Inovke cleanup lambda
    const deletionRequest = await lambda().invoke({
      FunctionName: functionName,
      Payload: new TextEncoder().encode(JSON.stringify({
        prefix: config.stackName,
        command: 'delete',
        filePaths: testFilePaths,
      })),
    });
    if (deletionRequest.StatusCode !== 200) {
      throw new Error(deletionRequest);
    }
  });

  describe('The Discover and Queue PDRs workflow', () => {
    let queuePdrsOutput;

    beforeAll(async () => {
      try {
        workflowExecution = await buildAndExecuteWorkflow(
          config.stackName,
          config.bucket,
          workflowName,
          { name: addedCollection.name, version: addedCollection.version },
          provider,
          undefined,
          { provider_path: testDataFolder }
        );

        queuePdrsOutput = await lambdaStep.getStepOutput(
          workflowExecution.executionArn,
          'QueuePdrs'
        );
      } catch (error) {
        beforeAllFailed = error;
        throw error;
      }
    });

    it('executes successfully', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      else {
        expect(workflowExecution.status).toEqual('completed');
      }
    });

    describe('the DiscoverPdrs Lambda', () => {
      let lambdaOutput;

      beforeAll(async () => {
        try {
          lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'DiscoverPdrs');
        } catch (error) {
          beforeAllFailed = true;
          throw error;
        }
      });

      it('has expected path and name output', () => {
        if (beforeAllFailed) fail(beforeAllFailed);
        else {
          expect(lambdaOutput.payload.pdrs[0].path).toEqual(testDataFolder);
          expect(lambdaOutput.payload.pdrs[0].name).toEqual(pdrFilename);
        }
      });
    });

    describe('the QueuePdrs Lambda', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      else {
        it('has expected output', () => {
          expect(queuePdrsOutput.payload.pdrs_queued).toEqual(1);
          expect(queuePdrsOutput.payload.running.length).toEqual(1);
        });
      }
    });

    /**
     * The DiscoverAndQueuePdrs workflow kicks off a ParsePdr workflow, so check that the
     * ParsePdr workflow completes successfully. Above, we checked that there is
     * one running task, which is the ParsePdr workflow. The payload has the arn of the
     * running workflow, so use that to get the status.
     */
    describe('The ParsePdr workflow', () => {
      let queueGranulesOutput;
      let expectedParsePdrOutput;
      let ingestGranuleWorkflowArn;

      const outputPayloadFilename = './spec/parallel/ingest/resources/ParsePdr.output.json';
      const collectionId = 'MOD09GQ___006';

      beforeAll(async () => {
        parsePdrExecutionArn = queuePdrsOutput.payload.running[0];

        try {
          expectedParsePdrOutput = loadFileWithUpdatedGranuleIdPathAndCollection(
            outputPayloadFilename,
            testDataGranuleId,
            testDataFolder,
            collectionId
          );

          expectedParsePdrOutput.granules[0].dataType += testSuffix;
          expectedParsePdrOutput.pdr.name = pdrFilename;
          expectedParsePdrOutput.granules[0].provider = nodeNameProviderId;
          await waitForCompletedExecution(parsePdrExecutionArn);
        } catch (error) {
          beforeAllFailed = true;
          throw error;
        }
      });

      afterAll(async () => {
        // wait for child executions to complete
        await Promise.all(
          queueGranulesOutput.payload.running
            .map((arn) => waitForCompletedExecution(arn))
        );
      });

      describe('QueueGranules lambda function', () => {
        it('has expected pdr and arns output', async () => {
          if (beforeAllFailed) fail(beforeAllFailed);
          else {
            queueGranulesOutput = await lambdaStep.getStepOutput(
              parsePdrExecutionArn,
              'QueueGranules'
            );

            expect(queueGranulesOutput.payload.running.length).toEqual(1);

            expect(queueGranulesOutput.payload.pdr.path).toEqual(expectedParsePdrOutput.pdr.path);
            expect(queueGranulesOutput.payload.pdr.name).toEqual(expectedParsePdrOutput.pdr.name);
          }
        });
      });

      /**
       * The parse pdr workflow kicks off a granule ingest workflow, so check that the
       * granule ingest workflow completes successfully. Above, we checked that there is
       * one running task, which is the sync granule workflow. The payload has the arn of the
       * running workflow, so use that to get the status.
       */
      describe('IngestGranule workflow', () => {
        let ingestGranuleExecutionStatus;

        beforeAll(async () => {
          try {
            // wait for IngestGranule execution to complete
            ingestGranuleWorkflowArn = queueGranulesOutput.payload.running[0];
            console.log(`Waiting for workflow to complete: ${ingestGranuleWorkflowArn}`);
            ingestGranuleExecutionStatus = await waitForCompletedExecution(ingestGranuleWorkflowArn);
          } catch (error) {
            beforeAllFailed = true;
            throw error;
          }
        });

        afterAll(async () => {
          // cleanup
          const finalOutput = await lambdaStep.getStepOutput(ingestGranuleWorkflowArn, 'MoveGranules');
          // delete ingested granule(s)
          await Promise.all(
            finalOutput.payload.granules.map(async (g) => {
              const newCollectionId = encodedConstructCollectionId(addedCollection.name, addedCollection.version);
              await waitForApiStatus(
                getGranule,
                {
                  prefix: config.stackName,
                  granuleId: g.granuleId,
                  collectionId: newCollectionId,
                },
                'completed'
              );
              await deleteGranule({
                prefix: config.stackName,
                granuleId: g.granuleId,
                collectionId: newCollectionId,
              });
            })
          );
          await deleteExecution({ prefix: config.stackName, executionArn: ingestGranuleWorkflowArn });
        });

        it('executes successfully', () => {
          if (beforeAllFailed) fail(beforeAllFailed);
          else {
            console.log('\nINGEST GRANULE STATUS', ingestGranuleExecutionStatus);
            expect(ingestGranuleExecutionStatus).toEqual('SUCCEEDED');
          }
        });

        describe('SyncGranule lambda function', () => {
          it('outputs 1 granule and pdr', async () => {
            if (beforeAllFailed) fail(beforeAllFailed);
            else {
              const lambdaOutput = await lambdaStep.getStepOutput(
                ingestGranuleWorkflowArn,
                'SyncGranule'
              );
              expect(lambdaOutput.payload.granules.length).toEqual(1);
              expect(lambdaOutput.payload.pdr).toEqual(lambdaOutput.payload.pdr);
            }
          });
        });
      });
    });

    describe('the reporting lambda has received the cloudwatch stepfunction event and', () => {
      it('the execution record is added to PostgreSQL', async () => {
        if (beforeAllFailed) fail(beforeAllFailed);
        else {
          const record = await waitForApiStatus(
            getExecution,
            { prefix: config.stackName, arn: parsePdrExecutionArn },
            'completed'
          );
          expect(record.status).toEqual('completed');
        }
      });

      it('the pdr record is added to PostgreSQL', async () => {
        if (beforeAllFailed) fail(beforeAllFailed);
        else {
          const record = await waitForApiStatus(
            getPdr,
            { prefix: config.stackName, pdrName: pdrFilename },
            'completed'
          );
          expect(record.execution).toEqual(getExecutionUrl(parsePdrExecutionArn));
          expect(record.status).toEqual('completed');
        }
      });
    });
  });
});
