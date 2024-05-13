'use strict';

const test = require('ava');
const sinon = require('sinon');
const uuidv4 = require('uuid/v4');
const { createHash } = require('crypto');
const S3 = require('@cumulus/aws-client/S3');

const { randomString } = require('@cumulus/common/test-utils');
const { unwrapDeadLetterCumulusMessage } = require('@cumulus/message/DeadLetterMessage');

const { fakeDeadLetterMessageFactory } = require('../../lib/testUtils');
const {
  processDeadLetterArchive, generateNewArchiveKeyForFailedMessage,
} = require('../../lambdas/process-s3-dead-letter-archive');

test.before(async (t) => {
  t.context.bucket = randomString();
  await S3.createBucket(t.context.bucket);
});

test.beforeEach(async (t) => {
  t.context.stackName = randomString();
  t.context.path = `${t.context.stackName}/dead-letter-archive/sqs/`;
  t.context.sqsPath = `${t.context.stackName}/dead-letter-archive/sqsTest/`;
  const dlaMessages = [
    fakeDeadLetterMessageFactory(),
    fakeDeadLetterMessageFactory(),
  ];

  const SQSMessage = fakeDeadLetterMessageFactory();
  t.context.SQSMessage = SQSMessage;
  t.context.dlaMessages = dlaMessages;
  t.context.messageKeys = [
    `${t.context.path}${dlaMessages[0].executionArn}.json`,
    `${t.context.path}${dlaMessages[1].executionArn}.json`,
  ];
  t.context.messageHashes = await Promise.all(
    dlaMessages.map(async (dlaMessage) => createHash('md5').update(JSON.stringify(await unwrapDeadLetterCumulusMessage(dlaMessage))).digest('hex'))
  );
  await Promise.all(dlaMessages.map((dlaMessage, index) => {
    const key = t.context.messageKeys[index];
    return S3.putJsonS3Object(
      t.context.bucket,
      key,
      dlaMessage
    );
  }));
  await S3.putJsonS3Object(
    t.context.bucket,
    `${t.context.sqsPath}/${SQSMessage.executionArn}`,
    SQSMessage
  );
});

test.after(async (t) => {
  await S3.recursivelyDeleteS3Bucket(t.context.bucket);
});

test('processDeadLetterArchive calls writeRecords for each dead letter Cumulus message', async (t) => {
  const writeRecordsFunctionSpy = sinon.spy();
  const { bucket, path } = t.context;
  const output = await processDeadLetterArchive({
    bucket,
    path,
    writeRecordsFunction: writeRecordsFunctionSpy,
  });
  t.true(writeRecordsFunctionSpy.calledTwice);
  const messageArgs = writeRecordsFunctionSpy.getCalls().map((call) => call.args[0].cumulusMessage);

  t.is(messageArgs.filter(
    (argMsg) => (
      t.context.messageHashes[0]
      === createHash('md5').update(JSON.stringify(argMsg)).digest('hex')
    )
  ).length, 1);
  t.is(messageArgs.filter(
    (argMsg) => (
      t.context.messageHashes[1]
      === createHash('md5').update(JSON.stringify(argMsg)).digest('hex')
    )
  ).length, 1);
  t.deepEqual(
    {
      processingSucceededKeys: output.processingSucceededKeys.sort(),
      processingFailedKeys: [],
    },
    {
      processingSucceededKeys: t.context.messageKeys.sort(),
      processingFailedKeys: [],
    }
  );
});

test('processDeadLetterArchive is able to handle processing multiple batches of dead letter records', async (t) => {
  const { bucket } = t.context;
  const path = `${randomString()}/new-dead-letter-archive/`;
  const writeRecordsFunctionSpy = sinon.spy();

  const numberOfDeadLetters = 40;
  const keys = [];
  for (let i = 0; i < numberOfDeadLetters; i += 1) {
    const key = `${path}${uuidv4()}.json`;
    keys.push(key);
    // eslint-disable-next-line no-await-in-loop
    await S3.putJsonS3Object(
      bucket,
      key,
      {}
    );
  }

  const output = await processDeadLetterArchive({
    bucket,
    path,
    writeRecordsFunction: writeRecordsFunctionSpy,
    batchSize: 15,
  });
  t.deepEqual(
    {
      processingSucceededKeys: output.processingSucceededKeys.sort(),
      processingFailedKeys: [],
    },
    {
      processingSucceededKeys: keys.sort(),
      processingFailedKeys: [],
    }
  );
  t.is(writeRecordsFunctionSpy.callCount, numberOfDeadLetters);
  const remainingDeadLetters = await S3.listS3ObjectsV2({ Bucket: bucket, Prefix: path });
  t.is(remainingDeadLetters.length, 0);
});

test('processDeadLetterArchive deletes dead letter that processed successfully', async (t) => {
  const { bucket, path } = t.context;
  const processedMessageKey = t.context.messageKeys[1];
  const writeRecordsErrorThrower = ({ cumulusMessage }) => {
    if (createHash('md5').update(JSON.stringify(cumulusMessage)).digest('hex') === t.context.messageHashes[1]) return;
    throw new Error('write failure');
  };
  const output = await processDeadLetterArchive({
    bucket,
    path,
    writeRecordsFunction: writeRecordsErrorThrower,
  });
  // Check that processed message key was deleted
  const processedDeadLetterExists = await S3.fileExists(bucket, processedMessageKey);
  t.is(processedDeadLetterExists, false);
  t.deepEqual(output.processingSucceededKeys, [processedMessageKey]);
});

test('processDeadLetterArchive saves failed dead letters to different S3 and removes from previous S3 path', async (t) => {
  const {
    bucket,
    path,
    messageKeys,
    stackName,
  } = t.context;
  process.env.stackName = stackName;
  const failingMessageKey = messageKeys[0];
  const failingFileContents = await S3.getJsonS3Object(bucket, failingMessageKey);
  const s3KeyForFailedMessage = generateNewArchiveKeyForFailedMessage(
    failingMessageKey,
    stackName,
    failingFileContents
  );
  const writeRecordsErrorThrower = ({ cumulusMessage }) => {
    if (createHash('md5').update(JSON.stringify(cumulusMessage)).digest('hex') === t.context.messageHashes[1]) return;
    throw new Error('write failure');
  };

  const output = await processDeadLetterArchive({
    bucket,
    path,
    writeRecordsFunction: writeRecordsErrorThrower,
  });
  // Check that failing message key was deleted
  const failingMessageRemainsInOldLocation = await S3.fileExists(bucket, failingMessageKey);
  t.is(failingMessageRemainsInOldLocation, false);
  t.deepEqual(output.processingFailedKeys, [failingMessageKey]);

  // Check that failing message key exists in new location
  const savedDeadLetterExists = await S3.fileExists(bucket, s3KeyForFailedMessage);
  t.truthy(savedDeadLetterExists);

  const fileContents = await S3.getJsonS3Object(bucket, s3KeyForFailedMessage);
  t.true(Object.keys(fileContents).length > 0);
});

test.serial('processDeadLetterArchive does not remove message from archive S3 path if transfer to new archive path fails', async (t) => {
  const {
    bucket,
    path,
    messageKeys,
    stackName,
    dlaMessages,
  } = t.context;
  const failingMessageKey = messageKeys[0];
  const failingMessage = dlaMessages[0];
  const s3KeyForFailedMessage = generateNewArchiveKeyForFailedMessage(
    failingMessageKey,
    stackName,
    failingMessage
  );
  const writeRecordsErrorThrower = ({ cumulusMessage }) => {
    if (createHash('md5').update(JSON.stringify(cumulusMessage)).digest('hex') === t.context.messageHashes[1]) return;
    throw new Error('write failure');
  };
  const s3Stub = sinon.stub(S3, 's3CopyObject').throws(
    new Error('Failed to copy object')
  );

  const output = await processDeadLetterArchive({
    bucket,
    path,
    writeRecordsFunction: writeRecordsErrorThrower,
  });

  // Check that failing message key was not deleted
  const remainingDeadLetterExists = await S3.fileExists(bucket, failingMessageKey);
  t.truthy(remainingDeadLetterExists);
  t.deepEqual(output.processingFailedKeys, [failingMessageKey]);

  // Check that failing message key does not exist in new location
  const failingMessageExistsInNewLocation = await S3.fileExists(bucket, s3KeyForFailedMessage);
  t.is(failingMessageExistsInNewLocation, false);
  t.teardown(() => {
    s3Stub.restore();
  });
});

test.serial('processDeadLetterArchive processes a SQS Message', async (t) => {
  const { bucket, sqsPath, SQSMessage } = t.context;
  const writeRecordsFunctionSpy = sinon.spy();

  await processDeadLetterArchive({
    bucket,
    path: sqsPath,
    writeRecordsFunction: writeRecordsFunctionSpy,
  });
  const cumulusMessage = await unwrapDeadLetterCumulusMessage(SQSMessage);
  t.deepEqual(writeRecordsFunctionSpy.getCall(0).firstArg.cumulusMessage, cumulusMessage);
});

test.serial('processDeadLetterArchive uses default values if no bucket and key are passed', async (t) => {
  const writeRecordsFunctionSpy = sinon.spy();
  process.env.system_bucket = t.context.bucket;
  process.env.stackName = t.context.stackName;
  await processDeadLetterArchive({
    writeRecordsFunction: writeRecordsFunctionSpy,
  });
  t.true(writeRecordsFunctionSpy.calledTwice);
  delete process.env.systemBucket;
  delete process.env.stackName;
});
