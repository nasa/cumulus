'use strict';

/**
 * End to end ingest from discovering a PDR
 *
 * Kick off discover and queue pdrs which:
 * Discovers 1 PDR
 * Queues that PDR
 * Kicks off the ParsePDR workflow
 *
 * Parse PDR workflow:
 * parses pdr
 * queues a granule
 * pdr status check
 * This will kick off the ingest workflow
 *
 * Ingest worklow:
 * runs sync granule - saves file to file staging location
 * performs the fake processing step - generates CMR metadata
 * Moves the file to the final location
 * Does not post to CMR (that is in a separate test)
 */

const { Collection, Execution, Pdr } = require('@cumulus/api/models');

const {
  aws: { s3, deleteS3Object }
} = require('@cumulus/common');

const {
  addCollections,
  addProviders,
  api: apiTestUtils,
  executionsApi: executionsApiTestUtils,
  buildAndExecuteWorkflow,
  cleanupProviders,
  cleanupCollections,
  granulesApi: granulesApiTestUtils,
  LambdaStep,
  waitForCompletedExecution
} = require('@cumulus/integration-tests');

const {
  createTestDataPath,
  createTestSuffix,
  createTimestampedTestId,
  deleteFolder,
  getExecutionUrl,
  loadConfig,
  updateAndUploadTestDataToBucket
} = require('../../helpers/testUtils');

const {
  loadFileWithUpdatedGranuleIdPathAndCollection
} = require('../../helpers/granuleUtils');

const config = loadConfig();
const lambdaStep = new LambdaStep();
const taskName = 'DiscoverAndQueuePdrs';
const origPdrFilename = 'MOD09GQ_1granule_v3.PDR';
let pdrFilename;

const s3data = [
  '@cumulus/test-data/pdrs/MOD09GQ_1granule_v3.PDR',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf'
];

describe('Ingesting from PDR', () => {
  const testId = createTimestampedTestId(config.stackName, 'IngestFromPdr');
  const testSuffix = createTestSuffix(testId);
  const testDataFolder = createTestDataPath(testId);

  pdrFilename = `${testSuffix.slice(1)}_${origPdrFilename}`;

  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };

  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  process.env.PdrsTable = `${config.stackName}-PdrsTable`;

  const executionModel = new Execution();
  const collectionModel = new Collection();
  const pdrModel = new Pdr();

  let parsePdrExecutionArn;

  beforeAll(async () => {
    // populate collections, providers and test data
    await Promise.all([
      updateAndUploadTestDataToBucket(
        config.bucket,
        s3data,
        testDataFolder,
        [
          { old: 'cumulus-test-data/pdrs', new: testDataFolder },
          { old: 'DATA_TYPE = MOD09GQ;', new: `DATA_TYPE = MOD09GQ${testSuffix};` }
        ]
      ),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
    ]);

    // update provider path
    await collectionModel.update(collection, { provider_path: testDataFolder });

    // Rename the PDR to avoid race conditions
    await s3().copyObject({
      Bucket: config.bucket,
      CopySource: `${config.bucket}/${testDataFolder}/${origPdrFilename}`,
      Key: `${testDataFolder}/${pdrFilename}`
    }).promise();

    await deleteS3Object(config.bucket, `${testDataFolder}/${origPdrFilename}`);
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
      apiTestUtils.deletePdr({
        prefix: config.prefix,
        pdr: pdrFilename
      })
    ]);
  });

  describe('The Discover and Queue PDRs workflow', () => {
    let workflowExecution;
    let queuePdrsOutput;

    beforeAll(async () => {
      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        taskName,
        collection,
        provider
      );

      queuePdrsOutput = await lambdaStep.getStepOutput(
        workflowExecution.executionArn,
        'QueuePdrs'
      );
    });

    it('executes successfully', () => {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    });

    describe('the DiscoverPdrs Lambda', () => {
      let lambdaOutput = null;

      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'DiscoverPdrs');
      });

      it('has expected path and name output', () => {
        expect(lambdaOutput.payload.pdrs[0].path).toEqual(testDataFolder);
        expect(lambdaOutput.payload.pdrs[0].name).toEqual(pdrFilename);
      });
    });

    describe('the QueuePdrs Lambda', () => {
      it('has expected output', () => {
        expect(queuePdrsOutput.payload.pdrs_queued).toEqual(1);
        expect(queuePdrsOutput.payload.running.length).toEqual(1);
      });
    });

    /**
     * The DiscoverAndQueuePdrs workflow kicks off a ParsePdr workflow, so check that the
     * ParsePdr workflow completes successfully. Above, we checked that there is
     * one running task, which is the ParsePdr workflow. The payload has the arn of the
     * running workflow, so use that to get the status.
     */
    describe('The ParsePdr workflow', () => {
      let parsePdrExecutionStatus;
      let parseLambdaOutput;
      let queueGranulesOutput;
      let expectedParsePdrOutput;

      const outputPayloadFilename = './spec/parallel/ingest/resources/ParsePdr.output.json';
      const testDataGranuleId = 'MOD09GQ.A2016358.h13v04.006.2016360104606';
      const collectionId = 'MOD09GQ___006';

      beforeAll(async () => {
        parsePdrExecutionArn = queuePdrsOutput.payload.running[0];
        console.log(`Wait for execution ${parsePdrExecutionArn}`);

        try {
          expectedParsePdrOutput = loadFileWithUpdatedGranuleIdPathAndCollection(
            outputPayloadFilename,
            testDataGranuleId,
            testDataFolder,
            collectionId
          );
          expectedParsePdrOutput.granules[0].dataType += testSuffix;
          expectedParsePdrOutput.pdr.name = pdrFilename;

          parsePdrExecutionStatus = await waitForCompletedExecution(parsePdrExecutionArn);

          queueGranulesOutput = await lambdaStep.getStepOutput(
            parsePdrExecutionArn,
            'QueueGranules'
          );
        }
        catch (error) {
          console.log(error);
        }
      });

      afterAll(async () => {
        // wait for child executions to complete
        queueGranulesOutput = await lambdaStep.getStepOutput(
          parsePdrExecutionArn,
          'QueueGranules'
        );
        await Promise.all(queueGranulesOutput.payload.running.map(async (arn) => {
          await waitForCompletedExecution(arn);
        }));
        await granulesApiTestUtils.deleteGranule({
          prefix: config.prefix,
          granuleId: parseLambdaOutput.payload.granules[0].granuleId
        });
      });

      it('executes successfully', () => {
        expect(parsePdrExecutionStatus).toEqual('SUCCEEDED');
      });

      describe('ParsePdr lambda function', () => {
        it('successfully parses a granule from the PDR', async () => {
          parseLambdaOutput = await lambdaStep.getStepOutput(
            parsePdrExecutionArn,
            'ParsePdr'
          );
          expect(parseLambdaOutput.payload.granules.length).toEqual(1);
        });
      });

      describe('QueueGranules lambda function', () => {
        it('has expected pdr and arns output', () => {
          expect(queueGranulesOutput.payload.running.length).toEqual(1);

          expect(queueGranulesOutput.payload.pdr.path).toEqual(expectedParsePdrOutput.pdr.path);
          expect(queueGranulesOutput.payload.pdr.name).toEqual(expectedParsePdrOutput.pdr.name);
        });
      });

      describe('PdrStatusCheck lambda function', () => {
        let lambdaOutput = null;

        beforeAll(async () => {
          lambdaOutput = await lambdaStep.getStepOutput(
            parsePdrExecutionArn,
            'PdrStatusCheck'
          );
        });

        it('has expected output', () => {
          const payload = lambdaOutput.payload;
          expect(payload.running.concat(payload.completed, payload.failed).length).toEqual(1);

          expect(payload.pdr.path).toEqual(expectedParsePdrOutput.pdr.path);
          expect(payload.pdr.name).toEqual(expectedParsePdrOutput.pdr.name);
        });
      });

      describe('SfSnsReport lambda function', () => {
        let lambdaOutput;
        beforeAll(async () => {
          lambdaOutput = await lambdaStep.getStepOutput(parsePdrExecutionArn, 'SfSnsReport');
        });

        // SfSnsReport lambda is used in the workflow multiple times, apparantly, only the first output
        // is retrieved which is the first step (StatusReport)
        it('has expected output message', () => {
          expect(lambdaOutput.payload.pdr.path).toEqual(expectedParsePdrOutput.pdr.path);
          expect(lambdaOutput.payload.pdr.name).toEqual(expectedParsePdrOutput.pdr.name);
        });
      });

      /**
       * The parse pdr workflow kicks off a granule ingest workflow, so check that the
       * granule ingest workflow completes successfully. Above, we checked that there is
       * one running task, which is the sync granule workflow. The payload has the arn of the
       * running workflow, so use that to get the status.
       */
      describe('IngestGranule workflow', () => {
        let ingestGranuleWorkflowArn;
        let ingestGranuleExecutionStatus;

        beforeAll(async () => {
          // wait for IngestGranule execution to complete
          ingestGranuleWorkflowArn = queueGranulesOutput.payload.running[0];
          console.log(`Waiting for workflow to complete: ${ingestGranuleWorkflowArn}`);
          ingestGranuleExecutionStatus = await waitForCompletedExecution(ingestGranuleWorkflowArn);
        });

        afterAll(async () => {
          // cleanup
          const finalOutput = await lambdaStep.getStepOutput(ingestGranuleWorkflowArn, 'SfSnsReport');
          // delete ingested granule(s)
          await Promise.all(
            finalOutput.payload.granules.map((g) =>
              granulesApiTestUtils.deleteGranule({
                prefix: config.prefix,
                granuleId: g.granuleId
              }))
          );
        });

        it('executes successfully', () => {
          expect(ingestGranuleExecutionStatus).toEqual('SUCCEEDED');
        });

        describe('SyncGranule lambda function', () => {
          it('outputs 1 granule and pdr', async () => {
            const lambdaOutput = await lambdaStep.getStepOutput(
              ingestGranuleWorkflowArn,
              'SyncGranule'
            );
            expect(lambdaOutput.payload.granules.length).toEqual(1);
            expect(lambdaOutput.payload.pdr).toEqual(lambdaOutput.payload.pdr);
          });
        });
      });

      /** This test relies on the previous 'IngestGranule workflow' to complete */
      describe('When accessing an execution via the API that was triggered from a parent step function', () => {
        it('displays a link to the parent', async () => {
          const ingestGranuleWorkflowArn = queueGranulesOutput.payload.running[0];
          const ingestGranuleExecutionResponse = await executionsApiTestUtils.getExecution({
            prefix: config.prefix,
            arn: ingestGranuleWorkflowArn
          });

          const ingestGranuleExecution = JSON.parse(ingestGranuleExecutionResponse.body);
          expect(ingestGranuleExecution.parentArn).toEqual(parsePdrExecutionArn);
        });
      });

      describe('When accessing an execution via the API that was not triggered from a parent step function', () => {
        it('does not display a parent link', async () => {
          const parsePdrExecutionResponse = await executionsApiTestUtils.getExecution({
            prefix: config.prefix,
            arn: workflowExecution.executionArn
          });

          const parsePdrExecution = JSON.parse(parsePdrExecutionResponse.body);
          expect(parsePdrExecution.parentArn).toBeUndefined();
        });
      });

      describe('the sf-sns-report task has published a sns message and', () => {
        it('the pdr record is added to DynamoDB', async () => {
          const record = await pdrModel.get({ pdrName: pdrFilename });
          expect(record.execution).toEqual(getExecutionUrl(parsePdrExecutionArn));
          expect(record.status).toEqual('completed');
        });

        it('the execution record is added to DynamoDB', async () => {
          const record = await executionModel.get({ arn: parsePdrExecutionArn });
          expect(record.status).toEqual('completed');
        });
      });

      describe('When a workflow is configured to make a choice based on the output of a Cumulus task', () => {
        let executionStatus;

        beforeAll(async () => {
          const executionStatusResponse = await executionsApiTestUtils.getExecutionStatus({
            prefix: config.prefix,
            arn: parsePdrExecutionArn
          });
          executionStatus = JSON.parse(executionStatusResponse.body);
        });

        it('branches according to the CMA output', async () => {
          expect(executionStatus.executionHistory).toBeTruthy();
          const events = executionStatus.executionHistory.events;

          // the output of the CheckStatus is used to determine the task of choice
          const checkStatusTaskName = 'CheckStatus';
          const stopStatusTaskName = 'StopStatus';
          const pdrStatusReportTaskName = 'PdrStatusReport';

          let choiceVerified = false;
          for (let i = 0; i < events.length; i += 1) {
            const currentEvent = events[i];
            if (currentEvent.type === 'TaskStateExited' &&
              currentEvent.name === checkStatusTaskName) {
              const output = JSON.parse(currentEvent.output);
              const isFinished = output.payload.isFinished;

              // get the next task executed
              let nextTask;
              while (!nextTask && i < events.length - 1) {
                i += 1;
                const nextEvent = events[i];
                if (nextEvent.type === 'TaskStateEntered' &&
                  nextEvent.name) {
                  nextTask = nextEvent.name;
                }
              }

              expect(nextTask).toBeTruthy();

              if (isFinished === true) {
                expect(nextTask).toEqual(stopStatusTaskName);
              }
              else {
                expect(nextTask).toEqual(pdrStatusReportTaskName);
              }
              choiceVerified = true;
            }
          }

          expect(choiceVerified).toBe(true);
        });
      });
    });

    /** This test relies on the previous 'ParsePdr workflow' to complete */
    describe('When accessing an execution via the API that was triggered from a parent step function', () => {
      it('displays a link to the parent', async () => {
        parsePdrExecutionArn = queuePdrsOutput.payload.running[0];
        const parsePdrExecutionResponse = await executionsApiTestUtils.getExecution({
          prefix: config.prefix,
          arn: parsePdrExecutionArn
        });

        const parsePdrExecution = JSON.parse(parsePdrExecutionResponse.body);
        expect(parsePdrExecution.parentArn).toEqual(workflowExecution.executionArn);
      });
    });

    describe('When accessing an execution via the API that was not triggered from a parent step function', () => {
      it('does not display a parent link', async () => {
        const queuePdrsExecutionResponse = await executionsApiTestUtils.getExecution({
          prefix: config.prefix,
          arn: workflowExecution.executionArn
        });

        const queuePdrsExecution = JSON.parse(queuePdrsExecutionResponse.body);
        expect(queuePdrsExecution.parentArn).toBeUndefined();
      });
    });


    describe('the sf-sns-report task has published a sns message and', () => {
      it('the execution record is added to DynamoDB', async () => {
        const record = await executionModel.get({ arn: parsePdrExecutionArn });
        expect(record.status).toEqual('completed');
      });
    });
  });
});
