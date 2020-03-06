'use strict';

const test = require('ava');
const { s3 } = require('@cumulus/aws-client/services');
const awsServices = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { noop } = require('@cumulus/common/util');
const {
  constructCollectionId
} = require('@cumulus/common/collection-config-store');
const { AssociatedRulesError } = require('../../lib/errors');
const { Collection, Rule } = require('../../models');
const {
  fakeCollectionFactory,
  fakeRuleFactoryV2
} = require('../../lib/testUtils');

let collectionsModel;
let ruleModel;

const testMessagesReceived = async (t, QueueUrl, eventType, collection) => {
  const { Messages } = await awsServices.sqs().receiveMessage({
    QueueUrl,
    WaitTimeSeconds: 3,
    MaxNumberOfMessages: 2
  }).promise();

  const snsMessages = Messages.map((message) => JSON.parse(message.Body));
  const dbRecords = snsMessages.map((message) => JSON.parse(message.Message));
  if (eventType === 'Create') {
    t.is(dbRecords[0].event, eventType);
    t.is(dbRecords[0].record.name, collection.name);
    t.is(dbRecords[0].record.version, collection.version);
  } else {
    t.is(dbRecords.length, 2);
    const deleteRecord = dbRecords.find((r) => (r.event === eventType));
    // {
    //   if(r.event = eventType) return r;
    // });
    t.is(deleteRecord.event, eventType);
    t.is(deleteRecord.record.name, collection.name);
    t.is(deleteRecord.record.version, collection.version);
  }
};

test.before(async () => {
  process.env.CollectionsTable = randomString();
  process.env.RulesTable = randomString();
  process.env.system_bucket = randomString();
  process.env.stackName = randomString();

  collectionsModel = new Collection();
  ruleModel = new Rule();

  await collectionsModel.createTable();
  await ruleModel.createTable();
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();
});

test.beforeEach(async (t) => {
  t.context.collectionSnsTopicArnEnvVarBefore = process.env.collection_sns_topic_arn;

  const topicName = randomString();
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: topicName
  }).promise();
  t.context.TopicArn = TopicArn;
  process.env.collection_sns_topic_arn = TopicArn;

  const QueueName = randomString();
  const { QueueUrl } = await awsServices.sqs().createQueue({ QueueName }).promise();
  t.context.QueueUrl = QueueUrl;

  const getQueueAttributesResponse = await awsServices.sqs().getQueueAttributes({
    QueueUrl: QueueUrl,
    AttributeNames: ['QueueArn']
  }).promise();
  const queueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await awsServices.sns().subscribe({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: queueArn
  }).promise();

  await awsServices.sns().confirmSubscription({
    TopicArn: TopicArn,
    Token: SubscriptionArn
  }).promise();
});

test.afterEach.always(async (t) => {
  const {
    collectionSnsTopicArnEnvVarBefore,
    QueueUrl,
    TopicArn
  } = t.context;

  process.env.collection_sns_topic_arn = collectionSnsTopicArnEnvVarBefore;

  await awsServices.sqs().deleteQueue({ QueueUrl }).promise()
    .catch(noop);
  await awsServices.sns().deleteTopic({ TopicArn }).promise()
    .catch(noop);
});

test.after.always(async () => {
  await collectionsModel.deleteTable();
  await ruleModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('Collection.create() sends a creation record to SNS', async (t) => {
  const name = randomString();
  const version = randomString();
  const { QueueUrl } = t.context;

  await collectionsModel.create(fakeCollectionFactory({ name, version }));

  await testMessagesReceived(t, QueueUrl, 'Create', { name, version });
});

test.serial('Collection.delete() sends a deletion record to SNS', async (t) => {
  const name = randomString();
  const version = randomString();
  const { QueueUrl } = t.context;

  await collectionsModel.create(fakeCollectionFactory({ name, version }));

  await collectionsModel.delete({ name, version });

  await testMessagesReceived(t, QueueUrl, 'Delete', { name, version });
});

test.serial('Collection.exists() returns true when a record exists', async (t) => {
  const name = randomString();
  const version = randomString();

  await collectionsModel.create(fakeCollectionFactory({ name, version }));

  t.true(await collectionsModel.exists(name, version));
});

test.serial('Collection.exists() returns false when a record does not exist', async (t) => {
  t.false(await collectionsModel.exists(randomString(), randomString()));
});

test.serial('Collection.delete() throws an exception if the collection has associated rules', async (t) => {
  const name = randomString();
  const version = randomString();

  await collectionsModel.create(fakeCollectionFactory({ name, version }));

  const rule = fakeRuleFactoryV2({
    collection: {
      name,
      version
    },
    rule: {
      type: 'onetime'
    }
  });

  // The workflow message template must exist in S3 before the rule can be created
  await Promise.all([
    s3().putObject({
      Bucket: process.env.system_bucket,
      Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
      Body: JSON.stringify({})
    }).promise(),
    s3().putObject({
      Bucket: process.env.system_bucket,
      Key: `${process.env.stackName}/workflow_template.json`,
      Body: JSON.stringify({})
    }).promise()
  ]);

  await ruleModel.create(rule);

  try {
    await collectionsModel.delete({ name, version });
    t.fail('Expected an exception to be thrown');
  } catch (err) {
    t.true(err instanceof AssociatedRulesError);
    t.is(err.message, 'Cannot delete a collection that has associated rules');
    t.deepEqual(err.rules, [rule.name]);
  }
});

test.serial(
  'Collection.delete() deletes a collection and removes its configuration store via name',
  async (t) => {
    const name = randomString();
    const version = randomString();
    const item = fakeCollectionFactory({ name, version });
    const { collectionConfigStore } = collectionsModel;
    const collectionId = constructCollectionId(name, version);

    await collectionsModel.create(item);
    t.true(await collectionsModel.exists(name, version));
    t.truthy(await collectionConfigStore.get(name, version));

    await collectionsModel.delete({ name, version });
    t.false(await collectionsModel.exists(name, version));
    // If the collection was successfully deleted from the config store, we
    // expect attempting to get it from the config store to throw an exception.
    await t.throwsAsync(
      async () => collectionConfigStore.get(name, version),
      { message: new RegExp(`${collectionId}`) }
    );
  }
);

test.serial('Collection.delete() does not throw exception when attempting to delete'
  + ' a collection that does not exist', async (t) => {
  const name = randomString();
  const version = randomString();

  t.false(await collectionsModel.exists(name, version));
  await collectionsModel.delete({ name, version });
  t.false(await collectionsModel.exists(name, version));
});
