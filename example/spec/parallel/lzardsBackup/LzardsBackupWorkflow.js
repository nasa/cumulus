'use strict';

const get = require('lodash/get');
const pAll = require('p-all');
const path = require('path');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { lambda } = require('@cumulus/aws-client/services');
const { putFile } = require('@cumulus/aws-client/S3');

const { loadConfig } = require('../../helpers/testUtils');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');

describe('The Lzards Backup workflow ', () => {
  let beforeAllFailed = false;
  let collection;
  let FunctionName;
  let prefix;
  let provider;
  let ingestBucket;
  let ingestPath;
  let workflowExecution;

  beforeAll(async () => {
    try {
      const config = await loadConfig();
      prefix = config.stackName;
      ingestBucket = config.buckets.protected.name;
      ingestPath = `${prefix}/lzardsBackupSpec`;
      await putFile(ingestBucket, `${ingestPath}/testGranule.dat`, path.join(__dirname, 'test_data', 'testGranule.dat'));
      await putFile(ingestBucket, `${ingestPath}/testGranule.jpg`, path.join(__dirname, 'test_data', 'testGranule.jpg'));
      FunctionName = `${prefix}-LzardsBackup`;
      functionConfig = await lambda().getFunctionConfiguration({
        FunctionName,
      }).promise();

      // Create the collection
      collection = await createCollection(
        prefix,
        {
          files: [
            {
              bucket: 'protected',
              regex: '^[^.]+\.jpg$',
              lzards: { backup: true },
              sampleFileName: 'asdf.jpg',
            },
            {
              bucket: 'protected',
              regex: '^[^.]+\.dat$',
              sampleFileName: 'asdf.dat',
            },
          ],
        }
      );

      const Payload = JSON.stringify({
        cma: {
          ReplaceConfig: {
            Path: '$.payload',
            TargetPath: '$.payload',
          },
          task_config: {
            cumulus_message: {
              outputs: [
                {
                  source: '{$.originalPayload}',
                  destination: '{$.payload}',
                },
                {
                  source: '{$.backupResults}',
                  destination: '{$.meta.backupStatus}',
                },
              ],
            },
          },
          event: {
            cumulus_meta: {
              system_bucket: config.bucket,
            },
            meta: {
              buckets: config.buckets,
              collection,
              provider,
              stack: config.stackName,
            },
            payload: {
              granules: [
                {
                  granuleId: 'FakeGranule2',
                  collectionId: `${collection.name}___${collection.version}`,
                  files: [
                    {
                      fileName: 'testGranule.jpg',
                      bucket: ingestBucket,
                      key: `${ingestPath}/testGranule.jpg`,
                      checksumType: 'md5',
                      checksum: '5799f9560b232baf54337d334179caa0',
                    },
                    {
                      fileName: 'testGranule.dat',
                      bucket: ingestBucket,
                      key: `${ingestPath}/testGranule.dat`,
                      checksumType: 'md5',
                      checksum: '39a870a194a787550b6b5d1f49629236',
                    },
                  ],
                },
              ],
            },
          },
        },
      });

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        'LzardsBackupWorkflow'
      )
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  it('executes succesfully', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    expect(workflowExecution.status).toEqual('completed');
  });

  it('has the expected step output', () => {
    beforeAll(async () => {
        activityOutput = await activityStep.getStepOutput(
          workflowExecution.executionArn,
          'LzardsBackupWorkflow'
        );
      });
    expect(activityOutput.payload).toEqual({});
  });

  afterAll(async () => {
    await pAll(
      [
        () => deleteCollection({
          prefix,
          collectionName: get(collection, 'name'),
          collectionVersion: get(collection, 'version'),
        }),
      ],
      { stopOnError: false }
    ).catch(console.error);
  });
});
