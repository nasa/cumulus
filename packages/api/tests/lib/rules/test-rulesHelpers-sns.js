const test = require('ava');
const sinon = require('sinon');

const awsServices = require('@cumulus/aws-client/services');
const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const {
  randomString,
} = require('@cumulus/common/test-utils');
const {
  destroyLocalTestDb,
  fakeRuleRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  RulePgModel,
} = require('@cumulus/db');
const { createRuleTrigger } = require('../../../lib/rulesHelpers');

const workflow = randomString();
const testDbName = randomString(12);
let sandbox;
test.before(async (t) => {
  process.env.stackName = randomString();
  process.env.messageConsumer = randomString();
  process.env.KinesisInboundEventLogger = randomString();
  process.env.system_bucket = randomString();
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;
  t.context.rulePgModel = new RulePgModel();

  await createBucket(process.env.system_bucket);

  const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
  const templateFile = `${process.env.stackName}/workflow_template.json`;
  await Promise.all([
    putJsonS3Object(
      process.env.system_bucket,
      workflowfile,
      {}
    ),
    putJsonS3Object(
      process.env.system_bucket,
      templateFile,
      {}
    ),
  ]);

  sandbox = sinon.createSandbox();
  sandbox.stub(awsServices, 'lambda')
    .returns({
      addPermission: () => ({
        promise: () => Promise.resolve(),
      }),
      removePermission: () => ({
        promise: () => Promise.resolve(),
      }),
    });
});

test.after.always(async (t) => {
  // cleanup table
  sandbox.restore();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  delete process.env.system_bucket;
  delete process.env.stackName;
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test.serial('creating a disabled SNS rule creates no event source mapping', async (t) => {
  const snsTopicArn = randomString();
  const item = fakeRuleRecordFactory({
    workflow,
    type: 'sns',
    value: snsTopicArn,
    enabled: false,
  });

  const rule = await createRuleTrigger(item);

  t.is(rule.enabled, false);
  t.is(rule.value, snsTopicArn);
  t.falsy(rule.arn);
});