'use strict';

const { fakeFileFactory, fakeGranuleFactoryV2 } = require('@cumulus/api/lib/testUtils');
const { SQS } = require('@cumulus/aws-client');
const { sqs } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const { deleteS3Object, waitForObjectToExist } = require('@cumulus/aws-client/S3');

const { loadConfig } = require('../../helpers/testUtils');

describe('When a record with no valid collection fails processing in the DbRecords lambda', () => {
  let beforeAllSucceeded = false;
  let stackName;
  let systemBucket;
  let failedMessageS3Id;
  let dbRecordsQueueUrl;
  let dbRecordsOriginalQueueAttributes;

  beforeAll(async () => {
    const config = await loadConfig();
    stackName = config.stackName;
    systemBucket = config.bucket;

    const inputQueueName = `${stackName}-sfEventSqsToDbRecordsInputQueue`;
    dbRecordsQueueUrl = await SQS.getQueueUrlByName(inputQueueName);
    const { Attributes } = await sqs().getQueueAttributes({
      QueueUrl: dbRecordsQueueUrl,
      AttributeNames: [
        'VisibilityTimeout',
        'RedrivePolicy',
      ],
    }).promise();
    dbRecordsOriginalQueueAttributes = Attributes;

    const updatedRedrivePolicy = JSON.parse(Attributes.RedrivePolicy);
    updatedRedrivePolicy.maxReceiveCount = 0;

    await sqs().setQueueAttributes({
      QueueUrl: dbRecordsQueueUrl,
      Attributes: {
        VisibilityTimeout: 5,
        RedrivePolicy: JSON.stringify(updatedRedrivePolicy),
      },
    });

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

    await SQS.sendSQSMessage(dbRecordsQueueUrl, JSON.stringify(failingMessage));
    beforeAllSucceeded = true;
  });

  afterAll(async () => {
    await sqs().setQueueAttributes({
      QueueUrl: dbRecordsQueueUrl,
      Attributes: dbRecordsOriginalQueueAttributes,
    });
    await deleteS3Object(
      systemBucket,
      `${stackName}/dead-letter-archive/sqs/${failedMessageS3Id}.json`
    );
  });

  describe('it ends up on the DbRecords DLQ and the writeDbRecordsDLQtoS3 lambda', () => {
    it('takes the message off the queue and writes it to S3', async () => {
      if (!beforeAllSucceeded) fail('beforeAll() failed');
      else {
        console.log(`Waiting for the creation of ${failedMessageS3Id}.json`);
        expect(await waitForObjectToExist({
          bucket: systemBucket,
          key: `${stackName}/dead-letter-archive/sqs/${failedMessageS3Id}.json`,
          interval: 5 * 1000,
          timeout: 180 * 1000,
        })).toBeTrue();
      }
    });
  });
});
