'use strict';

const { promiseS3Upload } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const { randomId, inTestMode } = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  getKnexClient,
  GranulePgModel,
  localStackConnectionEnv,
  ProviderPgModel,
  RulePgModel,
  translateApiCollectionToPostgresCollection,
  translateApiGranuleToPostgresGranule,
  translateApiProviderToPostgresProvider,
  translateApiRuleToPostgresRule,
} = require('@cumulus/db');

const { constructCollectionId } = require('@cumulus/message/Collections');

const testUtils = require('../lib/testUtils');
const serveUtils = require('./serveUtils');
const {
  localStackName,
  localSystemBucket,
  localUserName,
} = require('./local-test-defaults');

const workflowList = testUtils.getWorkflowList();

async function populateBucket(bucket, stackName) {
  // upload workflow files
  const workflowPromises = workflowList.map((obj) => promiseS3Upload({
    params: {
      Bucket: bucket,
      Key: `${stackName}/workflows/${obj.name}.json`,
      Body: JSON.stringify(obj),
    },
  }));

  // upload workflow template
  const workflow = `${stackName}/workflow_template.json`;
  const templatePromise = promiseS3Upload({
    params: {
      Bucket: bucket,
      Key: workflow,
      Body: JSON.stringify({}),
    },
  });
  await Promise.all([...workflowPromises, templatePromise]);
}

async function prepareServices(stackName, bucket) {
  await s3().createBucket({ Bucket: bucket });

  const { TopicArn } = await createSnsTopic(randomId('topicName'));
  process.env.collection_sns_topic_arn = TopicArn;
}

function getRequiredAuthEnvVariables() {
  const authEnvVariables = process.env.FAKE_AUTH
    ? []
    : ['EARTHDATA_CLIENT_ID', 'EARTHDATA_CLIENT_PASSWORD'];
  return authEnvVariables;
}

function setAuthEnvVariables() {
  if (process.env.FAKE_AUTH) {
    process.env.EARTHDATA_CLIENT_ID = randomId('EARTHDATA_CLIENT_ID');
    process.env.EARTHDATA_CLIENT_PASSWORD = randomId('EARTHDATA_CLIENT_PASSWORD');
    process.env.EARTHDATA_BASE_URL = 'https://example.com';
  }
}

function checkEnvVariablesAreSet(moreRequiredEnvVars) {
  const authEnvVariables = getRequiredAuthEnvVariables();
  const requiredEnvVars = authEnvVariables.concat(moreRequiredEnvVars);
  requiredEnvVars.forEach((env) => {
    if (!process.env[env]) {
      throw new Error(`Environment Variable ${env} is not set!`);
    }
  });
}

/**
 * Fill Postgres with fake records for testing.
 * @param {string} stackName - The name of local stack. Used to prefix stack resources.
 * @param {string} user - username
 * @param {Object} knexOverride - Used to override knex object for testing
 */
async function createDBRecords(stackName, user, knexOverride) {
  let knex = knexOverride;
  if (!knex) {
    knex = await getKnexClient({ env: { ...localStackConnectionEnv, ...process.env } });
  }

  const collectionPgModel = new CollectionPgModel();
  const granulePgModel = new GranulePgModel();
  const providerPgModel = new ProviderPgModel();
  const rulePgModel = new RulePgModel();

  await serveUtils.resetPostgresDb();

  if (user) {
    await testUtils.setAuthorizedOAuthUsers([user]);
  }
  // add collection records
  const collection = testUtils.fakeCollectionFactory({
    name: `${stackName}-collection`,
    version: '0.0.0',
  });
  await serveUtils.addCollections([collection]);
  const postgresCollection = await translateApiCollectionToPostgresCollection(collection);
  await collectionPgModel.upsert(knex, postgresCollection);

  // add provider records
  const provider = testUtils.fakeProviderFactory({ id: `${stackName}-provider` });
  await serveUtils.addProviders([provider]);
  const postgresProvider = await translateApiProviderToPostgresProvider(provider);
  providerPgModel.upsert(knex, postgresProvider);

  // add rule records
  const rule = testUtils.fakeRuleFactoryV2({
    name: `${stackName}_rule`,
    workflow: workflowList[0].name,
    provider: provider.name,
    collection: {
      name: collection.name,
      version: collection.version,
    },
    rule: {
      type: 'onetime',
    },
  });
  await serveUtils.addRules([rule]);
  const postgresRule = await translateApiRuleToPostgresRule(rule, knex);
  await rulePgModel.upsert(knex, postgresRule);

  // add fake execution records
  const parentExecution = testUtils.fakeExecutionFactoryV2({ arn: randomId('fake-arn'), parentArn: undefined });

  const execution = testUtils.fakeExecutionFactoryV2({ arn: `${stackName}-fake-arn`, parentArn: parentExecution.arn });

  await serveUtils.addExecutions([parentExecution, execution]);

  // add fake granule records
  const granule = testUtils.fakeGranuleFactoryV2({
    granuleId: `${stackName}-granule`,
    collectionId: constructCollectionId(collection.name, collection.version),
    execution: execution.execution,
    published: false, // Important - we need to be able to delete these.
    status: 'completed',
  });

  await serveUtils.addGranules([granule]);
  const postgresGranule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: granule,
    knexOrTransaction: knex,
  });
  await granulePgModel.upsert({
    granule: postgresGranule,
    knexOrTrx: knex,
  });

  // add pdrs records
  const pdr = testUtils.fakePdrFactoryV2({
    pdrName: `${stackName}-pdr`,
    provider: provider.id,
    collectionId: constructCollectionId(collection.name, collection.version),
  });
  await serveUtils.addPdrs([pdr]);
}

/**
 * Prepare and run the Cumulus API Express app.
 *
 * @param {string} user - A username to add as an authorized user for the API.
 * @param {string} stackName - The name of local stack. Used to prefix stack resources.
 * @param {bool} reseed - boolean to control whether to load new data into
 *                        Postgres.
 */
async function serveApi(user, stackName = localStackName, reseed = true) {
  const port = process.env.PORT || 5001;
  const requiredEnvVars = [
    'stackName',
    'system_bucket',
    'TOKEN_REDIRECT_ENDPOINT',
    'TOKEN_SECRET',
  ];

  // Set env variable to mark this as a local run of the API
  process.env.CUMULUS_ENV = 'local';
  process.env.API_BASE_URL = `http://localhost:${port}`;
  process.env.TOKEN_REDIRECT_ENDPOINT = `http://localhost:${port}/token`;
  process.env.TOKEN_SECRET = randomId('tokensecret');

  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
  };

  if (inTestMode()) {
    // set env variables
    setAuthEnvVariables();
    process.env.system_bucket = localSystemBucket;
    process.env.stackName = stackName;

    checkEnvVariablesAreSet(requiredEnvVars);

    await prepareServices(stackName, process.env.system_bucket);
    await populateBucket(process.env.system_bucket, stackName);
    if (reseed) {
      await createDBRecords(stackName, user);
    }
  } else {
    checkEnvVariablesAreSet(requiredEnvVars);
  }

  console.log(`Starting server on port ${port}`);
  const { app } = require('../app'); // eslint-disable-line global-require
  app.listen(port);
}

/**
 * Prepare and run the Cumulus distribution API Express app.
 *
 * @param {string} stackName - The name of local stack. Used to prefix stack resources.
 * @param {function} done - Optional callback to fire when app has started listening.
 */
async function serveDistributionApi(stackName = localStackName, done) {
  const port = process.env.PORT || 5002;
  const requiredEnvVars = [
    'DISTRIBUTION_REDIRECT_ENDPOINT',
    'DISTRIBUTION_ENDPOINT',
  ];

  // Set env variable to mark this as a local run of the API
  process.env.CUMULUS_ENV = 'local';

  // Point distribution API to local
  process.env.DISTRIBUTION_REDIRECT_ENDPOINT = `http://localhost:${port}/redirect`;
  process.env.DISTRIBUTION_ENDPOINT = `http://localhost:${port}`;

  if (inTestMode()) {
    // set env variables
    setAuthEnvVariables();
    process.env.system_bucket = localSystemBucket;

    checkEnvVariablesAreSet(requiredEnvVars);

    await prepareServices(stackName, process.env.system_bucket);
    await populateBucket(process.env.system_bucket, stackName);
    await createDBRecords(stackName);
  } else {
    checkEnvVariablesAreSet(requiredEnvVars);
  }

  console.log(`Starting server on port ${port}`);
  const { distributionApp } = require('../app/distribution'); // eslint-disable-line global-require
  return distributionApp.listen(port, done);
}

/**
 * Removes all additional data from tables and repopulates with original data.
 *
 * @param {string} user - defaults to local user, testUser
 * @param {string} stackName - defaults to local stack, localrun
 * @param {string} systemBucket - defaults to 'localbucket', localrun
 * @param {bool} runIt - Override check to prevent accidental AWS run.  default: 'false'.
 */
async function resetTables(
  user = localUserName,
  stackName = localStackName,
  runIt = false
) {
  if (inTestMode() || runIt) {
    const knex = await getKnexClient({ env: { ...localStackConnectionEnv, ...process.env } });
    await serveUtils.erasePostgresTables(knex);
    await createDBRecords(stackName, user, knex);
  }
}

module.exports = {
  serveApi,
  serveDistributionApi,
  resetTables,
};
