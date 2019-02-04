'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { s3, recursivelyDeleteS3Bucket } = require('@cumulus/common/aws');
const { Search } = require('../../es/search');
const indexer = require('../../es/indexer');
const bootstrap = require('../../lambdas/bootstrap');
const models = require('../../models');
const migrations = require('../../migrations');
const migration0 = require('../../migrations/migration_0');
const migration1 = require('../../migrations/migration_1');
const { fakeGranuleFactory, fakeExecutionFactory, deleteAliases } = require('../../lib/testUtils');

let esClient;
const esIndex = randomString();


let executionModel;
let executionsTable;
let granuleModel;
let granulesTable;
test.before(async () => {
  process.env.system_bucket = randomString();
  process.env.stackName = randomString();

  await deleteAliases();
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  granulesTable = `${process.env.stackName}-GranulesTable`;
  process.env.GranulesTable = granulesTable;
  granuleModel = new models.Granule();
  await granuleModel.createTable();

  executionsTable = `${process.env.stackName}-ExecutionsTable`;
  process.env.ExecutionsTable = executionsTable;
  executionModel = new models.Execution();
  await executionModel.createTable();

  esClient = await Search.es();
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await granuleModel.deleteTable();
  await executionModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
});

test.serial('Run migrations the first time, it should run', async (t) => {
  const options = { msg: 'this is a test' };
  const output = await migrations([migration0], options);
  t.is(output.length, 1);
  t.is(output[0], options);

  const Key = `${process.env.stackName}/migrations/migration_0`;

  await s3().headObject({
    Bucket: process.env.system_bucket,
    Key
  }).promise();
});

test.serial('Run the migration again, it should not run', async (t) => {
  const output = await migrations([migration0]);
  t.is(output.length, 0);

  const Key = `${process.env.stackName}/migrations/migration_0`;

  await s3().headObject({
    Bucket: process.env.system_bucket,
    Key
  }).promise();
});

test.serial('migrate records from ES to DynamoDB', async (t) => {
  // add 15 granules records
  const granules = (new Array(...new Array(15))).map(() => fakeGranuleFactory());

  // add 15 execution records
  const executions = (new Array(...new Array(15))).map(() => fakeExecutionFactory());

  // make sure tables and es indexes are empty
  const granuleIndex = new Search({}, 'granule', esIndex);
  const executionIndex = new Search({}, 'execution', esIndex);

  let granuleCount = await granuleIndex.count();
  t.is(granuleCount.meta.found, 0);

  let executionCount = await executionIndex.count();
  t.is(executionCount.meta.found, 0);

  // adding records to elasticsearch
  await Promise.all(granules.map((g) => indexer.indexGranule(esClient, g, esIndex)));
  await Promise.all(executions.map((e) => indexer.indexExecution(esClient, e, esIndex)));

  granuleCount = await granuleIndex.count();
  t.is(granuleCount.meta.found, 15);

  executionCount = await executionIndex.count();
  t.is(executionCount.meta.found, 15);

  // run migration
  await migration1.run({
    tables: [
      granulesTable,
      executionsTable
    ],
    elasticsearch_host: Search.getLocalEsHost(),
    elasticsearch_index: esIndex
  });

  // check records exists in dynamoDB
  granuleCount = await granuleIndex.count();
  t.is(granuleCount.meta.found, 15);

  executionCount = await executionIndex.count();
  t.is(executionCount.meta.found, 15);

  await Promise.all(granules.map((g) => granuleModel.get({ granuleId: g.granuleId })));
  await Promise.all(executions.map((e) => executionModel.get({ arn: e.arn })));
});
