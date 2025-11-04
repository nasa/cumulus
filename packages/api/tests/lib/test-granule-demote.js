'use strict';

const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const cryptoRandomString = require('crypto-random-string');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const s3Client = require('@cumulus/aws-client/S3');
const { sns, sqs } = require('@cumulus/aws-client/services');
const { SubscribeCommand, DeleteTopicCommand } = require('@aws-sdk/client-sns');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const {
  createBucket,
  deleteS3Buckets,
  s3PutObject,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const {
  CollectionPgModel,
  FilePgModel,
  GranulePgModel,
  GranuleGroupsPgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  fakeGranuleRecordFactory,
  translateApiCollectionToPostgresCollection,
} = require('@cumulus/db');

const {
  fakeCollectionFactory,
} = require('../../lib/testUtils');
const { updateDatabaseRecords } = require('../../src/lib/granule-demote-promote');

// Create stubs
const unpublishGranuleStub = sinon.stub().resolves();
const publishGranuleUpdateSnsMessageStub = sinon.stub().resolves();

// Import module under test with stubs injected
const { demoteGranule } = proxyquire('../../src/lib/granule-demote-promote', {
  '../../lib/granule-remove-from-cmr': { unpublishGranule: unpublishGranuleStub },
  '../../lib/publishSnsMessageUtils': { publishGranuleUpdateSnsMessage: publishGranuleUpdateSnsMessageStub },
});

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;
let granulePgModel;
let filePgModel;
let granuleGroupsModel;

process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('bucket');
process.env.TOKEN_SECRET = randomId('secret');

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  // Create fake buckets
  const visibleBucket = randomId('visible');
  const hiddenBucket = randomId('hidden');
  await createBucket(visibleBucket);
  await createBucket(hiddenBucket);

  t.context.visibleBucket = visibleBucket;
  t.context.hiddenBucket = hiddenBucket;

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  granulePgModel = new GranulePgModel();
  filePgModel = new FilePgModel();
  granuleGroupsModel = new GranuleGroupsPgModel();

  // Create collection
  t.context.testCollection = fakeCollectionFactory({
    name: 'fakeCollection',
    version: 'v1',
    duplicateHandling: 'error',
    hiddenFileBucket: hiddenBucket,
  });

  const collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await collectionPgModel.create(
    knex,
    translateApiCollectionToPostgresCollection(t.context.testCollection)
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;
  t.context.collectionPgModel = collectionPgModel;
});

test.beforeEach(async (t) => {
  const topicName = randomString();
  const { TopicArn } = await createSnsTopic(topicName);
  process.env.granule_sns_topic_arn = TopicArn;
  t.context.TopicArn = TopicArn;

  const QueueName = randomString();
  const { QueueUrl } = await sqs().createQueue({ QueueName });
  t.context.QueueUrl = QueueUrl;
  const getQueueAttributesResponse = await sqs().getQueueAttributes({
    QueueUrl,
    AttributeNames: ['QueueArn'],
  });
  const QueueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await sns().send(
    new SubscribeCommand({ TopicArn, Protocol: 'sqs', Endpoint: QueueArn })
  );
  t.context.SubscriptionArn = SubscriptionArn;
});

test.afterEach.always(async (t) => {
  sinon.resetHistory();
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl });
  await sns().send(new DeleteTopicCommand({ TopicArn }));
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });

  await deleteS3Buckets([t.context.visibleBucket, t.context.hiddenBucket]);
});

test.serial.only('demoteGranule() moves files to hidden bucket and updates DB records', async (t) => {
  const { knex, collectionCumulusId, visibleBucket, hiddenBucket } = t.context;

  const granuleId = randomId('granule');
  const fakePgGranule = fakeGranuleRecordFactory({
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });
  const [pgGranule] = await granulePgModel.create(knex, fakePgGranule);

  const fileKey = `${granuleId}/file.txt`;
  await s3PutObject({
    Bucket: visibleBucket,
    Key: fileKey,
    Body: 'test-content' });

  // TODO granule is published initialially
  // TODO multiple files
  const [createdFile] = await filePgModel.create(knex, {
    granule_cumulus_id: pgGranule.cumulus_id,
    bucket: visibleBucket,
    key: fileKey,
    file_name: 'file.txt',
  });

  t.true(await s3ObjectExists({ Bucket: visibleBucket, Key: fileKey }));

  await demoteGranule({
    knex,
    granuleId,
    granulePgModel,
    filePgModel,
    granuleGroupsModel,
  });

  const hiddenKey = `${granuleId}/${fileKey}`;
  t.false(await s3ObjectExists({ Bucket: visibleBucket, Key: fileKey }));
  t.true(await s3ObjectExists({ Bucket: hiddenBucket, Key: hiddenKey }));

  const updatedFile = await filePgModel.get(knex, { cumulus_id: createdFile.cumulus_id });
  t.is(updatedFile.bucket, hiddenBucket);
  t.is(updatedFile.key, hiddenKey);

  const groupRecord = await granuleGroupsModel.search(knex, {
    granule_cumulus_id: pgGranule.cumulus_id,
  });
  t.truthy(groupRecord[0]);
  t.is(groupRecord[0].state, 'H');

  t.true(unpublishGranuleStub.calledOnce);
  const args = unpublishGranuleStub.firstCall.args[0];
  t.deepEqual(args.knex, knex);
  t.true(publishGranuleUpdateSnsMessageStub.calledOnce);
});

test.serial.only('demoteGranule() rolls back file moves if one file move fails', async (t) => {
  const { knex, collectionCumulusId, visibleBucket, hiddenBucket } = t.context;

  const granuleId = randomId('granule');
  const fakePgGranule = fakeGranuleRecordFactory({
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });
  const [pgGranule] = await granulePgModel.create(knex, fakePgGranule);

  const fileKeys = [`${granuleId}/file1.txt`, `${granuleId}/file2.txt`];
  await Promise.all(fileKeys.map((key) => s3PutObject({
    Bucket: visibleBucket,
    Key: key,
    Body: 'test-content' })));

  const filesToCreate = fileKeys.map((key) => ({
    granule_cumulus_id: pgGranule.cumulus_id,
    bucket: visibleBucket,
    key,
    file_name: key.split('/').pop(),
  }));
  const createdFiles = await filePgModel.create(knex, filesToCreate, '*');

  sinon.stub(s3Client, 'moveObject').callsFake(({ sourceKey }) => {
    if (sourceKey.endsWith('file2.txt')) throw new Error('Simulated move failure');
    return true;
  });

  const error = await t.throwsAsync(() =>
    demoteGranule({
      knex,
      granuleId,
      granulePgModel,
      filePgModel,
      granuleGroupsModel,
    }));

  t.true(error.message.includes('Simulated move failure'));

  for (const key of fileKeys) {
    // eslint-disable-next-line no-await-in-loop
    t.true(await s3ObjectExists({ Bucket: visibleBucket, Key: key }));
    // eslint-disable-next-line no-await-in-loop
    t.false(await s3ObjectExists({ Bucket: hiddenBucket, Key: `${granuleId}/${key}` }));
  }

  for (const createdFile of createdFiles) {
    // eslint-disable-next-line no-await-in-loop
    const dbFile = await filePgModel.get(knex, { cumulus_id: createdFile.cumulus_id });
    t.is(dbFile.bucket, visibleBucket);
    t.is(dbFile.key, createdFile.key);
  }

  t.true(unpublishGranuleStub.calledOnce);
  const args = unpublishGranuleStub.firstCall.args[0];
  t.deepEqual(args.knex, knex);
  t.true(publishGranuleUpdateSnsMessageStub.notCalled);
});

test.serial('demoteGranule() rolls back if file copy succeeds but delete fails', async (t) => {
  const { knex, collectionCumulusId, visibleBucket, hiddenBucket } = t.context;

  const granuleId = randomId('granule');
  const fakePgGranule = fakeGranuleRecordFactory({
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });
  const [pgGranule] = await granulePgModel.create(knex, fakePgGranule);

  const fileKey = `${granuleId}/file.txt`;
  await s3PutObject(visibleBucket, fileKey, 'test-content');

  const [pgFile] = await filePgModel.create(knex, {
    granule_cumulus_id: pgGranule.cumulus_id,
    bucket: visibleBucket,
    key: fileKey,
    file_name: 'file.txt',
  });

  sinon.stub(s3Client, 'moveObject').callsFake(async (params) => {
    if (params.destinationBucket === hiddenBucket) {
      await s3PutObject(params.destinationBucket, params.destinationKey, 'copied-content');
    }
    throw new Error('Simulated S3 delete failure');
  });

  const error = await t.throwsAsync(() =>
    demoteGranule({
      knex,
      granuleId,
      granulePgModel,
      filePgModel,
      granuleGroupsModel,
    }));

  t.true(error.message.includes('Simulated S3 delete failure'));
  t.true(await s3ObjectExists({ Bucket: visibleBucket, Key: fileKey }));

  const hiddenKey = `${granuleId}/${fileKey}`;
  t.false(await s3ObjectExists({ Bucket: hiddenBucket, Key: hiddenKey }));

  const fileRecord = await filePgModel.get(knex, { cumulus_id: pgFile.cumulus_id });
  t.is(fileRecord.bucket, visibleBucket);
  t.is(fileRecord.key, fileKey);
});

test.serial('demoteGranule() should not exceed concurrency limit when moving many files (placeholder)', async (t) => {
  const { knex, collectionCumulusId, visibleBucket, hiddenBucket } = t.context;

  // Create granule with multiple files
  const granuleId = randomId('granule');
  const fakePgGranule = fakeGranuleRecordFactory({
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });
  const [pgGranule] = await granulePgModel.create(knex, fakePgGranule);

  const totalFiles = 10;
  const keys = Array.from({ length: totalFiles }, (_, i) => `${granuleId}/file${i}.txt`);
  await Promise.all(keys.map((key) => s3PutObject(visibleBucket, key, 'test-content')));

  for (const key of keys) {
    await filePgModel.create(knex, {
      granule_cumulus_id: pgGranule.cumulus_id,
      bucket: visibleBucket,
      key,
      file_name: key.split('/').pop(),
    });
  }

  // Track concurrent move operations
  let concurrent = 0;
  let maxConcurrent = 0;

  const moveObjectStub = sinon.stub().callsFake(async (args) => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 20)); // simulate work
    concurrent -= 1;
  });
  require.cache[require.resolve('@cumulus/aws-client/S3')].exports.moveObject = moveObjectStub;

  await demoteGranule({
    knex,
    granuleId,
    granulePgModel,
    filePgModel,
    granuleGroupsModel,
  });

  // For now, concurrency may equal total files — future limit test will assert < some threshold
  t.true(maxConcurrent >= 1);

  // Clean up stub
  delete require.cache[require.resolve('@cumulus/aws-client/S3')];
});

test.serial('updateDatabaseRecords() creates granule group if none exists', async (t) => {
  const { knex, collectionCumulusId } = t.context;

  // Create a granule and file
  const granuleId = randomId('granule');
  const fakePgGranule = fakeGranuleRecordFactory({
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const [pgGranule] = await granulePgModel.create(knex, fakePgGranule);

  const pgFile = {
    granule_cumulus_id: pgGranule.cumulus_id,
    bucket: 'fake-bucket',
    key: 'file.txt',
    file_name: 'file.txt',
  };
  const [createdFile] = await filePgModel.create(knex, pgFile);

  // Verify no group exists yet
  const existingGroup = await granuleGroupsModel.search(knex, {
    granule_cumulus_id: pgGranule.cumulus_id,
  });
  t.is(existingGroup.length, 0);

  // Call updateDatabaseRecords (should create new group)
  await updateDatabaseRecords({
    knex,
    filePgModel,
    granuleGroupsModel,
    files: [{
      ...createdFile,
      newBucket: 'new-bucket',
      newKey: 'new-key.txt',
    }],
    granuleCumulusId: pgGranule.cumulus_id,
  });

  // Verify granule group created
  const newGroup = await granuleGroupsModel.search(knex, {
    granule_cumulus_id: pgGranule.cumulus_id,
  });
  t.is(newGroup.length, 1);
  t.is(newGroup[0].state, 'H');

  // Verify file record updated
  const updatedFile = await filePgModel.get(knex, { cumulus_id: createdFile.cumulus_id });
  t.is(updatedFile.bucket, 'new-bucket');
  t.is(updatedFile.key, 'new-key.txt');
});

test.serial('updateDatabaseRecords() updates existing granule group if it already exists', async (t) => {
  const { knex, collectionCumulusId } = t.context;

  // Create a granule and file
  const granuleId = randomId('granule');
  const fakePgGranule = fakeGranuleRecordFactory({
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const [pgGranule] = await granulePgModel.create(knex, fakePgGranule);

  const pgFile = {
    granule_cumulus_id: pgGranule.cumulus_id,
    bucket: 'fake-bucket',
    key: 'file.txt',
    file_name: 'file.txt',
  };
  const [createdFile] = await filePgModel.create(knex, pgFile);

  // Create an existing granule group (state = 'V')
  const [existingGroup] = await granuleGroupsModel.create(knex, {
    granule_cumulus_id: pgGranule.cumulus_id,
    state: 'V',
  });

  // Call updateDatabaseRecords with updated file
  await updateDatabaseRecords({
    knex,
    filePgModel,
    granuleGroupsModel,
    files: [{
      ...createdFile,
      newBucket: 'updated-bucket',
      newKey: 'updated-key.txt',
    }],
    granuleCumulusId: pgGranule.cumulus_id,
    existingGroup: [existingGroup],
  });

  // Verify granule group was updated (state changed to 'H')
  const updatedGroup = await granuleGroupsModel.get(knex, { cumulus_id: existingGroup.cumulus_id });
  t.is(updatedGroup.state, 'H');

  // Verify file record updated too
  const updatedFile = await filePgModel.get(knex, { cumulus_id: createdFile.cumulus_id });
  t.is(updatedFile.bucket, 'updated-bucket');
  t.is(updatedFile.key, 'updated-key.txt');
});

test.serial('updateDatabaseRecords() rolls back if database transaction fails', async (t) => {
  const { knex, collectionCumulusId } = t.context;

  // Create granule + file
  const granuleId = randomId('granule');
  const fakePgGranule = fakeGranuleRecordFactory({
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  const [pgGranule] = await granulePgModel.create(knex, fakePgGranule);

  const pgFile = {
    granule_cumulus_id: pgGranule.cumulus_id,
    bucket: 'source-bucket',
    key: 'file.txt',
    file_name: 'file.txt',
  };
  const [createdFile] = await filePgModel.create(knex, pgFile);

  // Monkey-patch FilePgModel.upsert() to simulate DB failure
  const filePgModelStub = new FilePgModel();
  const upsertStub = sinon.stub(filePgModelStub, 'upsert').throws(new Error('Simulated DB error'));

  await t.throwsAsync(
    () => updateDatabaseRecords({
      knex,
      filePgModel: filePgModelStub,
      granuleGroupsModel: new GranuleGroupsPgModel(),
      files: [{
        ...createdFile,
        newBucket: 'updated-bucket',
        newKey: 'updated-key.txt',
      }],
      granuleCumulusId: pgGranule.cumulus_id,
    }),
    { message: /Simulated DB error/ }
  );

  // DB should remain unchanged
  const fileAfter = await filePgModel.get(knex, { cumulus_id: createdFile.cumulus_id });
  t.is(fileAfter.bucket, 'source-bucket');
  t.is(fileAfter.key, 'file.txt');
});
