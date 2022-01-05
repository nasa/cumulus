'use strict';

const rewire = require('rewire');
const sinon = require('sinon');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  sns,
  sqs,
} = require('@cumulus/aws-client/services');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');

const SQS = require('@cumulus/aws-client/SQS');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  localStackConnectionEnv,
  migrationDir,
  translatePostgresGranuleToApiGranule,
} = require('@cumulus/db');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const schedule = rewire('../../lambdas/sf-scheduler');
const Granule = require('../../models/granules');

const defaultQueueUrl = 'defaultQueueUrl';
const customQueueUrl = 'userDefinedQueueUrl';

const fakeMessageResponse = {
  cumulus_meta: {
    queueExecutionLimits: {
      [customQueueUrl]: 5,
    },
  },
};
const scheduleEventTemplate = {
  collection: 'fakeCollection',
  provider: 'fakeProvider',
  cumulus_meta: {},
  payload: {},
  template: fakeMessageResponse,
  definition: {},
};
const fakeCollection = {
  name: 'fakeCollection',
  version: '000',
};
const fakeProvider = {
  id: 'fakeProviderId',
  host: 'fakeHost',
};

const sqsStub = sinon.stub(SQS, 'sendSQSMessage');

const fakeGetCollection = (item) => {
  if (item.collectionName !== fakeCollection.name
      || item.collectionVersion !== fakeCollection.version) {
    return Promise.reject(new Error('Collection could not be found'));
  }
  return Promise.resolve(fakeCollection);
};

const fakeGetProvider = ({ providerId }) => {
  if (providerId !== fakeProvider.id) {
    return Promise.reject(new Error('Provider could not be found'));
  }
  return Promise.resolve({ body: JSON.stringify(fakeProvider) });
};
const getApiProvider = schedule.__get__('getApiProvider');
const getApiCollection = schedule.__get__('getApiCollection');
const resetProvider = schedule.__set__('getProvider', fakeGetProvider);
const resetCollection = schedule.__set__('getCollection', fakeGetCollection);
const testDbName = randomId('sf-scheduler-test');
process.env.CollectionsTable = randomString();
process.env.GranulesTable = randomString();

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
    GranulesTable: randomId('granule'),
    defaultSchedulerQueueUrl: defaultQueueUrl,
  };
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.granulePgModel = new GranulePgModel();

  const granuleModel = new Granule();
  await granuleModel.createTable();
  t.context.granuleModel = granuleModel;

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
});

test.beforeEach(async (t) => {
  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  process.env.granule_sns_topic_arn = TopicArn;
  t.context.TopicArn = TopicArn;

  const QueueName = cryptoRandomString({ length: 10 });
  const { QueueUrl } = await sqs().createQueue({ QueueName }).promise();
  t.context.QueueUrl = QueueUrl;
  const getQueueAttributesResponse = await sqs()
    .getQueueAttributes({
      QueueUrl,
      AttributeNames: ['QueueArn'],
    })
    .promise();
  const QueueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await sns()
    .subscribe({
      TopicArn,
      Protocol: 'sqs',
      Endpoint: QueueArn,
    })
    .promise();

  await sns()
    .confirmSubscription({
      TopicArn,
      Token: SubscriptionArn,
    })
    .promise();
});

test.afterEach.always(async (t) => {
  sqsStub.resetHistory();
  const { QueueUrl, TopicArn } = t.context;

  await sqs().deleteQueue({ QueueUrl }).promise();
  await sns().deleteTopic({ TopicArn }).promise();
});

test.after.always(async (t) => {
  const { granuleModel } = t.context;
  resetProvider();
  resetCollection();
  sqsStub.restore();
  await granuleModel.deleteTable();
  await destroyLocalTestDb({
    ...t.context,
  });
  await cleanupTestIndex(t.context);
});

test.serial('getApiProvider returns undefined when input is falsey', async (t) => {
  const response = await getApiProvider(undefined);
  t.is(response, undefined);
});

test.serial('getApiProvider returns provider when input is a valid provider ID', async (t) => {
  const response = await getApiProvider(fakeProvider.id);
  t.deepEqual(JSON.parse(response.body), fakeProvider);
});

test.serial('getApiCollection returns undefined when input is falsey', async (t) => {
  const response = await getApiCollection(undefined);
  t.is(response, undefined);
});

test.serial('getApiCollection returns collection when input is a valid collection name/version', async (t) => {
  const collectionInput = {
    name: fakeCollection.name,
    version: fakeCollection.version,
  };

  const response = await getApiCollection(collectionInput);

  t.deepEqual(response, fakeCollection);
});

test.serial('Sends an SQS message to the custom queue URL if queueUrl is defined', async (t) => {
  const scheduleInput = {
    ...scheduleEventTemplate,
    queueUrl: customQueueUrl,
    provider: fakeProvider.id,
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
  };
  await schedule.handleScheduleEvent(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;
  t.is(targetQueueUrl, customQueueUrl);
  t.is(targetMessage.cumulus_meta.queueExecutionLimits[customQueueUrl], 5);
  t.deepEqual(targetMessage.meta.collection, fakeCollection);
  t.deepEqual(targetMessage.meta.provider, fakeProvider);
});

test.serial('Sends an SQS message to the default queue if queueUrl is not defined', async (t) => {
  const scheduleInput = {
    ...scheduleEventTemplate,
    provider: fakeProvider.id,
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
  };

  await schedule.handleScheduleEvent(scheduleInput);

  t.is(sqsStub.calledOnce, true);

  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;
  t.is(targetQueueUrl, defaultQueueUrl);
  t.deepEqual(targetMessage.meta.collection, fakeCollection);
  t.deepEqual(targetMessage.meta.provider, fakeProvider);
});

test.serial('_updateGranuleStatusToQueued updates payload granules status to queued', async (t) => {
  const {
    collectionPgModel,
    granulePgModel,
    granuleModel,
    knex,
  } = t.context;
  const fakePgCollection = fakeCollectionRecordFactory({
    name: fakeCollection.name,
    version: fakeCollection.version,
  });
  const [pgCollection] = await collectionPgModel.create(
    knex,
    fakePgCollection
  );
  const generateRandomGranuleId = () => `granuleId_${cryptoRandomString({ length: 10 })}`;
  const granuleIds = [generateRandomGranuleId(), generateRandomGranuleId()];
  const pgGranules = (await Promise.all(
    granuleIds.map((granuleId) =>
      granulePgModel.create(
        knex,
        fakeGranuleRecordFactory(
          {
            granule_id: granuleId,
            collection_cumulus_id: pgCollection.cumulus_id,
          }
        )
      ))
  )).flat();
  const apiGranules = await Promise.all(
    pgGranules.map((g) =>
      translatePostgresGranuleToApiGranule(
        {
          granulePgRecord: g,
          collectionPgRecord: pgCollection,
          knexOrTransaction: knex,
        }
      ))
  );

  await Promise.all(apiGranules.map(
    (granule) =>
      granuleModel.create(granule)
  ));

  const granulesBeforeScheduledEvent = await Promise.all(pgGranules.map(
    (g) =>
      granulePgModel.get(knex, {
        cumulus_id: g.cumulus_id,
      })
  ));
  granulesBeforeScheduledEvent.map((g) => t.not(g.status, 'queued'));

  const scheduleInput = {
    ...scheduleEventTemplate,
    provider: fakeProvider.id,
    collection: {
      name: fakeCollection.name,
      version: fakeCollection.version,
    },
    payload: {
      granules: apiGranules,
    },
  };

  await schedule.handleScheduleEvent(scheduleInput);

  const granulesAfterScheduledEvent = await Promise.all(pgGranules.map(
    (g) =>
      granulePgModel.get(knex, {
        cumulus_id: g.cumulus_id,
      })
  ));
  const [targetQueueUrl, targetMessage] = sqsStub.getCall(0).args;

  granulesAfterScheduledEvent.map((g) => t.is(g.status, 'queued'));
  t.is(targetQueueUrl, defaultQueueUrl);
  t.deepEqual(targetMessage.payload.granules, apiGranules);
});
