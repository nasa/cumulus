'use strict';

const fs = require('fs-extra');
const test = require('ava');
const sinon = require('sinon');

const S3 = require('@cumulus/aws-client/S3');
const awsServices = require('@cumulus/aws-client/services');
const { randomId } = require('@cumulus/common/test-utils');
const workflows = require('@cumulus/common/workflows');

const models = require('../../../models');
const { fakeRuleFactoryV2 } = require('../../../lib/testUtils');

let rulesModel;
let sandbox;

const testCollectionName = randomId('collection');
const collection = {
  name: testCollectionName,
  version: '0.0.0',
};
const provider = { id: 'PROV1' };

// Kinesis rules
const commonRuleParams = {
  collection,
  provider: provider.id,
  workflow: randomId('workflow'),
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const kinesisRuleParams = {
  rule: {
    type: 'kinesis',
    value: `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`,
  },
};

const kinesisRule1 = {
  ...commonRuleParams,
  ...kinesisRuleParams,
  name: 'testRule1',
  state: 'ENABLED',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// if the state is not provided, it will be set to default value 'ENABLED'
const kinesisRule2 = {
  ...commonRuleParams,
  ...kinesisRuleParams,
  name: 'testRule2',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const kinesisRule3 = {
  ...commonRuleParams,
  ...kinesisRuleParams,
  collection: {
    name: testCollectionName,
    version: '1.0.0',
  },
  name: 'testRule3',
  state: 'ENABLED',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const kinesisRule4 = {
  ...commonRuleParams,
  name: 'testRule4',
  state: 'ENABLED',
  rule: {
    type: 'kinesis',
    value: `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis4_')}`,
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const kinesisRule5 = {
  ...commonRuleParams,
  collection: {
    name: testCollectionName,
    version: '2.0.0',
  },
  name: 'testRule5',
  state: 'ENABLED',
  rule: {
    type: 'kinesis',
    value: `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis5_')}`,
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const disabledKinesisRule = {
  ...commonRuleParams,
  ...kinesisRuleParams,
  name: 'disabledRule',
  state: 'DISABLED',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

test.before(async () => {
  process.env.RulesTable = randomId('rules');
  process.env.stackName = randomId('stack');
  process.env.KinesisInboundEventLogger = randomId('kinesis');
  process.env.system_bucket = randomId('bucket');

  const lambda = await awsServices.lambda().createFunction({
    Code: {
      ZipFile: fs.readFileSync(require.resolve('@cumulus/test-data/fake-lambdas/hello.zip')),
    },
    FunctionName: randomId('messageConsumer'),
    Role: randomId('role'),
    Handler: 'index.handler',
    Runtime: 'nodejs16.x',
  }).promise();
  process.env.messageConsumer = lambda.FunctionName;

  // create Rules table
  rulesModel = new models.Rule({
    SqsUtils: {
      sqsQueueExists: () => Promise.resolve(true),
    },
    SqsClient: {
      getQueueAttributes: () => ({
        promise: () => Promise.resolve({
          Attributes: {
            RedrivePolicy: 'fake-policy',
            VisibilityTimeout: '10',
          },
        }),
      }),
    },
  });
  await rulesModel.createTable();

  await S3.createBucket(process.env.system_bucket);
  const templateFile = `${process.env.stackName}/workflow_template.json`;
  await Promise.all([
    S3.putJsonS3Object(
      process.env.system_bucket,
      templateFile,
      {}
    ),
  ]);

  sandbox = sinon.createSandbox();

  const stubWorkflowFileKey = randomId('key');
  sandbox.stub(workflows, 'getWorkflowFileKey').returns(stubWorkflowFileKey);
  sandbox.stub(S3, 'fileExists')
    .withArgs(
      process.env.system_bucket,
      stubWorkflowFileKey
    )
    .resolves(true);
  sandbox.stub(S3, 'getJsonS3Object')
    .withArgs(
      process.env.system_bucket,
      stubWorkflowFileKey
    )
    .resolves({});

  const kinesisRules = [
    kinesisRule1,
    kinesisRule2,
    kinesisRule3,
    kinesisRule4,
    kinesisRule5,
    disabledKinesisRule,
  ];

  await Promise.all(kinesisRules.map(async (rule) => {
    const ruleWithTrigger = await rulesModel.createRuleTrigger(rule);
    return rulesModel.create(ruleWithTrigger);
  }));
});

test.after.always(async () => {
  sandbox.restore();
  await rulesModel.deleteTable();
  await S3.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('queryRules returns correct rules for given state and type', async (t) => {
  const onetimeRules = [
    fakeRuleFactoryV2({
      rule: {
        type: 'onetime',
      },
      state: 'ENABLED',
    }),
    fakeRuleFactoryV2({
      rule: {
        type: 'sqs',
        value: randomId('queue'),
      },
      state: 'ENABLED',
    }),
    fakeRuleFactoryV2({
      rule: {
        type: 'onetime',
      },
      state: 'DISABLED',
    }),
  ];
  await Promise.all(
    onetimeRules.map(async (rule) => {
      await rulesModel.createRuleTrigger(rule);
      await rulesModel.create(rule);
    })
  );

  const result = await rulesModel.queryRules({
    status: 'ENABLED',
    type: 'onetime',
  });
  t.truthy(result.find((rule) => rule.name === onetimeRules[0].name));
  t.falsy(result.find((rule) => rule.name === onetimeRules[1].name));
  t.falsy(result.find((rule) => rule.name === onetimeRules[2].name));

  t.teardown(async () => {
    await Promise.all(onetimeRules.map((rule) => rulesModel.delete(rule)));
  });
});

test.serial('queryRules defaults to returning only ENABLED rules', async (t) => {
  const enabledRule = fakeRuleFactoryV2({
    rule: {
      type: 'onetime',
    },
    state: 'ENABLED',
  });
  const rules = [
    enabledRule,
    fakeRuleFactoryV2({
      rule: {
        type: 'onetime',
      },
      state: 'DISABLED',
    }),
  ];

  const rulesWithTriggers = await Promise.all(
    rules.map((rule) => rulesModel.createRuleTrigger(rule))
  );
  await Promise.all(rulesWithTriggers.map((rule) => rulesModel.create(rule)));

  const results = await rulesModel.queryRules({
    type: 'onetime',
  });
  t.is(results.length, 1);
  t.deepEqual(rules[0], enabledRule);

  t.teardown(async () => {
    await Promise.all(rules.map((rule) => rulesModel.delete(rule)));
  });
});

test.serial('queryRules should look up sns-type rules which are associated with the topic, but not those that are disabled', async (t) => {
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: randomId('topic'),
  }).promise();

  const rules = [
    fakeRuleFactoryV2({
      rule: {
        type: 'sns',
        value: TopicArn,
      },
      state: 'ENABLED',
    }),
    fakeRuleFactoryV2({
      rule: {
        type: 'sns',
        value: TopicArn,
      },
      state: 'DISABLED',
    }),
  ];
  const createdRules = await Promise.all(rules.map(async (rule) => {
    const ruleWithTrigger = await rulesModel.createRuleTrigger(rule);
    return rulesModel.create(ruleWithTrigger);
  }));

  const result = await rulesModel.queryRules({
    type: 'sns',
    sourceArn: TopicArn,
  });
  t.is(result.length, 1);
  t.deepEqual(result[0], createdRules[0]);
  t.teardown(async () => {
    await Promise.all(createdRules.map((rule) => rulesModel.delete(rule)));
    await awsServices.sns().deleteTopic({
      TopicArn,
    });
  });
});

test.serial('queryRules should look up sns-type rules which are associated with the collection', async (t) => {
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: randomId('topic'),
  }).promise();

  const rules = [
    fakeRuleFactoryV2({
      rule: {
        type: 'sns',
        value: TopicArn,
      },
      collection,
      state: 'ENABLED',
    }),
    fakeRuleFactoryV2({
      rule: {
        type: 'sns',
        value: TopicArn,
      },
      state: 'ENABLED',
    }),
  ];

  const ruleWithTrigger1 = await rulesModel.createRuleTrigger(rules[0]);
  const rule1 = await rulesModel.create(ruleWithTrigger1);

  const ruleWithTrigger2 = await rulesModel.createRuleTrigger(rules[1]);
  const rule2 = await rulesModel.create(ruleWithTrigger2);

  const result = await rulesModel.queryRules({
    type: 'sns',
    name: collection.name,
    version: collection.version,
  });
  t.is(result.length, 1);
  t.deepEqual(result[0], rule1);
  t.teardown(async () => {
    await rulesModel.delete(rule1);
    await rulesModel.delete(rule2);
    await awsServices.sns().deleteTopic({
      TopicArn,
    });
  });
});

test('queryRules should look up kinesis-type rules which are associated with the collection, but not those that are disabled', async (t) => {
  const result = await rulesModel.queryRules({
    name: testCollectionName,
    type: 'kinesis',
  });
  t.is(result.length, 5);
});

test('queryRules should look up kinesis-type rules which are associated with the collection name and version', async (t) => {
  const result = await rulesModel.queryRules({
    name: testCollectionName,
    version: '1.0.0',
    type: 'kinesis',
  });
  t.is(result.length, 1);
});

test('queryRules should look up kinesis-type rules which are associated with the source ARN', async (t) => {
  const result = await rulesModel.queryRules({
    sourceArn: kinesisRule4.rule.value,
    type: 'kinesis',
  });
  t.is(result.length, 1);
});

test('queryRules should look up kinesis-type rules which are associated with the collection name/version and source ARN', async (t) => {
  const result = await rulesModel.queryRules({
    name: testCollectionName,
    version: '2.0.0',
    sourceArn: kinesisRule5.rule.value,
    type: 'kinesis',
  });
  t.is(result.length, 1);
});
