const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');

const {
  generateLocalTestDb,
  localStackConnectionEnv,
  GranulePgModel,
  migrationDir,
  destroyLocalTestDb,
  CollectionPgModel,
  fakeCollectionRecordFactory,
} = require('@cumulus/db');
const { createBucket, deleteS3Buckets } = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const { CMR } = require('@cumulus/cmr-client');

const { sns, sqs, secretsManager } = require('@cumulus/aws-client/services');
const {
  SubscribeCommand,
  DeleteTopicCommand,
} = require('@aws-sdk/client-sns');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');

const { bulkGranuleRemoveFromCmr } = require('../../lambdas/bulk-operation');
const { createGranuleAndFiles } = require('../helpers/create-test-data');

const testDbName = `${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  process.env.system_bucket = randomId('bucket');
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  // create a fake bucket
  await createBucket(process.env.system_bucket);

  // Store a fake CMR password, needed by getCmrSettings()
  process.env.cmr_password_secret_name = randomString();
  await secretsManager().createSecret({
    Name: process.env.cmr_password_secret_name,
    SecretString: randomString(),
  });

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
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

  const { SubscriptionArn } = await sns().send(new SubscribeCommand({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: QueueArn,
  }));

  t.context.SubscriptionArn = SubscriptionArn;
});

test.afterEach(async (t) => {
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl });
  await sns().send(new DeleteTopicCommand({ TopicArn }));
});

test.after.always(async (t) => {
  await secretsManager().deleteSecret({
    SecretId: process.env.cmr_password_secret_name,
    ForceDeleteWithoutRecovery: true,
  });
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test('bulkGranuleRemoveFromCmr removes granules from CMR without deleting them', async (t) => {
  const {
    knex,
  } = t.context;

  const granulePgModel = new GranulePgModel();
  const collectionPgModel = new CollectionPgModel();
  const collection = fakeCollectionRecordFactory();
  const [collectionPgRecord] = await collectionPgModel.create(
    t.context.knex,
    collection
  );

  const granules = await Promise.all([
    createGranuleAndFiles({
      dbClient: knex,
      granuleParams: {
        published: true,
        collection_cumulus_id: collectionPgRecord.cumulus_id,
      },
      writeDynamo: false,
    }),
    createGranuleAndFiles({
      dbClient: knex,
      granuleParams: {
        published: true,
        collection_cumulus_id: collectionPgRecord.cumulus_id,
      },
      writeDynamo: false,
    }),
  ]);

  const pgGranule1 = granules[0].newPgGranule;
  const pgGranule2 = granules[1].newPgGranule;
  const pgGranuleId1 = pgGranule1.granule_id;
  const pgGranuleId2 = pgGranule2.granule_id;

  const removeGranuleFromCmrFunctionMock = () => true;

  const granuleIds = [pgGranuleId1, pgGranuleId2];

  const results = await bulkGranuleRemoveFromCmr(
    {
      granules: granuleIds,
    },
    removeGranuleFromCmrFunctionMock
  );

  t.deepEqual(
    results.sort(),
    granuleIds.sort()
  );

  // Granules should still exist in Postgres, but unpublished
  const updatedGranule1 = await granulePgModel.get(knex, { granule_id: pgGranuleId1 });
  const updatedGranule2 = await granulePgModel.get(knex, { granule_id: pgGranuleId2 });
  t.false(updatedGranule1.published);
  t.false(updatedGranule2.published);
  t.falsy(updatedGranule1.cmr_link);
  t.falsy(updatedGranule2.cmr_link);

  const s3Buckets = granules[0].s3Buckets;
  t.teardown(() => deleteS3Buckets([
    s3Buckets.protected.name,
    s3Buckets.public.name,
  ]));
});

test.serial('ensure bulkGranuleRemoveFromCmr passes correct cmr_provider to unpublishGranule', async (t) => {
  const { knex } = t.context;
  const [collectionPgRecord] = await new CollectionPgModel().create(
    knex, fakeCollectionRecordFactory()
  );

  const granule = await createGranuleAndFiles({
    dbClient: knex,
    granuleParams: {
      published: true,
      collection_cumulus_id: collectionPgRecord.cumulus_id,
    },
    writeDynamo: false,
  });

  const removeGranuleFromCmrFunctionMock = sinon.stub().resolves();
  const unpublishGranuleFuncStub = sinon.stub().callsFake(({
    knex: knexParam,
    pgGranuleRecord,
    pgCollection,
    removeGranuleFromCmrFunction,
  }) => {
    t.truthy(knexParam);
    t.truthy(pgGranuleRecord);
    t.truthy(pgCollection);
    t.truthy(pgCollection.cmr_provider);
    t.is(removeGranuleFromCmrFunction, removeGranuleFromCmrFunctionMock);

    return { pgGranule: pgGranuleRecord };
  });

  await bulkGranuleRemoveFromCmr(
    {
      granules: [granule.newPgGranule.granule_id],
    },
    removeGranuleFromCmrFunctionMock,
    unpublishGranuleFuncStub
  );

  t.true(unpublishGranuleFuncStub.called);
  const firstCallArgs = unpublishGranuleFuncStub.firstCall.args[0];
  t.truthy(firstCallArgs.pgCollection.cmr_provider);
  t.is(firstCallArgs.pgCollection.cmr_provider, collectionPgRecord.cmr_provider);

  t.teardown(() => deleteS3Buckets([
    granule.s3Buckets.protected.name,
    granule.s3Buckets.public.name,
  ]));
});

test.serial('bulkGranuleRemoveFromCmr calls the real CMR client for each published granule', async (t) => {
  const { knex } = t.context;

  const [collectionPgRecord] = await new CollectionPgModel().create(
    knex, fakeCollectionRecordFactory()
  );

  // Give each granule a distinct cmr_link so we can verify each one is individually
  // passed through to the (stubbed) CMR client.
  const cmrLink1 = `https://cmr.example.com/granule/${randomId('granule')}`;
  const cmrLink2 = `https://cmr.example.com/granule/${randomId('granule')}`;

  const granules = await Promise.all([
    createGranuleAndFiles({
      dbClient: knex,
      granuleParams: {
        published: true,
        cmrLink: cmrLink1,
        collection_cumulus_id: collectionPgRecord.cumulus_id,
      },
      writeDynamo: false,
    }),
    createGranuleAndFiles({
      dbClient: knex,
      granuleParams: {
        published: true,
        cmrLink: cmrLink2,
        collection_cumulus_id: collectionPgRecord.cumulus_id,
      },
      writeDynamo: false,
    }),
  ]);

  const granuleIds = granules.map((g) => g.newPgGranule.granule_id);
  const expectedTitleByCmrLink = {
    [cmrLink1]: `title-for-${cmrLink1}`,
    [cmrLink2]: `title-for-${cmrLink2}`,
  };

  const cmrMetadataStub = sinon.stub(CMR.prototype, 'getGranuleMetadata')
    .callsFake((cmrLink) => Promise.resolve({ title: expectedTitleByCmrLink[cmrLink] }));
  const cmrDeleteStub = sinon.stub(CMR.prototype, 'deleteGranule').resolves();
  t.teardown(() => {
    cmrMetadataStub.restore();
    cmrDeleteStub.restore();
  });

  const results = await bulkGranuleRemoveFromCmr({ granules: granuleIds });

  t.deepEqual(results.sort(), granuleIds.sort());
  t.is(cmrMetadataStub.callCount, 2);
  t.is(cmrDeleteStub.callCount, 2);
  [cmrLink1, cmrLink2].forEach((cmrLink) => {
    const matchingCall = cmrDeleteStub.getCalls().find(
      (call) => call.args[0] === expectedTitleByCmrLink[cmrLink]
    );
    t.truthy(matchingCall, `expected deleteGranule to be called for ${cmrLink}`);
  });

  const granulePgModel = new GranulePgModel();
  await Promise.all(granuleIds.map(async (granuleId) => {
    const updated = await granulePgModel.get(knex, { granule_id: granuleId });
    t.false(updated.published);
    t.falsy(updated.cmr_link);
  }));

  t.teardown(() => deleteS3Buckets([
    granules[0].s3Buckets.protected.name,
    granules[0].s3Buckets.public.name,
  ]));
});

test('bulkGranuleRemoveFromCmr records a soft error when a granule does not exist', async (t) => {
  const removeGranuleFromCmrFunctionMock = () => true;
  const missingGranuleId = `missing-${cryptoRandomString({ length: 10 })}`;

  const results = await bulkGranuleRemoveFromCmr(
    {
      granules: [missingGranuleId],
    },
    removeGranuleFromCmrFunctionMock
  );

  t.deepEqual(results, [{ granuleId: missingGranuleId, error: 'RecordDoesNotExist' }]);
});
