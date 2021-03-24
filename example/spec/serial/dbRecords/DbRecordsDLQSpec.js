'use strict';

const { fakeFileFactory, fakeGranuleFactoryV2 } = require('@cumulus/api/lib/testUtils');
const { SQS } = require('@cumulus/aws-client');
const { sqs } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const { deleteS3Object, waitForObjectToExist } = require('@cumulus/aws-client/S3');

const { loadConfig } = require('../../helpers/testUtils');

describe('When a bad record is sent on the DLQ', () => {
  let beforeAllSucceeded = false;
  let stackName;
  let systemBucket;
  let failedMessageS3Id;
  let dbRecordsDLQUrl;
  let dbRecordsOriginalQueueAttributes;

  beforeAll(async () => {
    const config = await loadConfig();
    stackName = config.stackName;
    systemBucket = config.bucket;

    const DLQName = `${stackName}-sfEventSqsToDbRecordsDeadLetterQueue`;
    dbRecordsDLQUrl = await SQS.getQueueUrlByName(DLQName);

    const granuleId = randomString(10);
    const files = [fakeFileFactory()];
    const granule = fakeGranuleFactoryV2({ files, granuleId });

    const executionName = `execution-${randomString(16)}`;
    failedMessageS3Id = `${executionName}-1`;

    const failingMessage = {
      cumulus_meta: {
        workflow_start_time: 122,
        cumulus_version: '7.1.0',
        state_machine: 'arn:aws:states:us-east-1:1234:execution:state-machine-name:execution-name',
        execution_name: executionName,
      },
      meta: {
        status: 'failed',
        collection: 'bad-collection',
        provider: 'fake-provider',
      },
      payload: {
        granules: [granule],
      },
    };

    // Send the message directly on the DLQ. Sending the message on the input queue results in an
    // extremely long-duration, unreliable test (>20 mins) because updates to the redrive policy
    // are very slow and unreliable and our normal visibilityTimeout and maxReceiveCount are high.
    await SQS.sendSQSMessage(dbRecordsDLQUrl, JSON.stringify(failingMessage));
    beforeAllSucceeded = true;
  });

  afterAll(async () => {
    await sqs().setQueueAttributes({
      QueueUrl: dbRecordsDLQUrl,
      Attributes: dbRecordsOriginalQueueAttributes,
    });
    await deleteS3Object(
      systemBucket,
      `${stackName}/dead-letter-archive/sqs/${failedMessageS3Id}.json`
    );
  });

  describe('the writeDbDlqRecordstoS3 lambda', () => {
    it('takes the message off the queue and writes it to S3', async () => {
      if (!beforeAllSucceeded) fail('beforeAll() failed');
      else {
        console.log(`Waiting for the creation of ${failedMessageS3Id}.json`);
        try {
          expect(await waitForObjectToExist({
            bucket: systemBucket,
            key: `${stackName}/dead-letter-archive/sqs/${failedMessageS3Id}.json`,
            interval: 5 * 1000,
            timeout: 30 * 1000,
          })).toBeUndefined();
        } catch (err) {
          fail(`Did not find expected S3 Object: ${err}`);
        }
      }
    });
  });
});
