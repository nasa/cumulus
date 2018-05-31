'use strict';

const test = require('ava');
const bootstrap = require('../lambdas/bootstrap');
const { randomString } = require('@cumulus/common/test-utils');
const { Search } = require('../es/search');
const mappings = require('../models/mappings.json');
const testMappings = require('./data/testEsMappings.json');
const mappingsSubset = require('./data/testEsMappingsSubset.json');
const { s3 } = require('@cumulus/common/aws');

let esClient;

test.serial('bootstrap creates index with alias', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  t.is(await esClient.indices.exists({ index: indexName }), true);

  const alias = await esClient.indices.getAlias({ name: testAlias });

  t.deepEqual(Object.keys(alias), [indexName]);

  await esClient.indices.delete({ index: indexName });
});

test.serial('bootstrap adds alias to existing index', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  esClient = await Search.es();

  await esClient.indices.create({
    index: indexName,
    body: { mappings }
  });

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  const alias = await esClient.indices.getAlias({ name: testAlias });

  t.deepEqual(Object.keys(alias), [indexName]);

  await esClient.indices.delete({ index: indexName });
});

test.serial('Missing types added to index', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  esClient = await Search.es();

  await esClient.indices.create({
    index: indexName,
    body: { mappings: mappingsSubset }
  });

  t.deepEqual(
    await bootstrap.findMissingMappings(esClient, indexName, Object.keys(testMappings)),
    ['logs', 'deletedgranule']
  );

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  t.deepEqual(
    await bootstrap.findMissingMappings(esClient, indexName, Object.keys(testMappings)),
    []
  );

  await esClient.indices.delete({ index: indexName });
});

async function migrationScript(x) {
  console.log('params: ' + x);
}


test.serial('', async (t) => {
  process.env.internal = randomString();
  process.env.stackName = 'test-stack';
  const Key = `${process.env.stackName}/migrations.txt`;

  await s3().createBucket({ Bucket: process.env.internal }).promise();

  const scripts = [
    { script: 'script1', timestamp: '6/1/18' },
    { script: 'script2', timestamp: '6/1/18' }
  ];

  await s3().putObject({
    Bucket: process.env.internal,
    Key,
    Body: JSON.stringify(scripts)
  }).promise();

  await bootstrap.runMigrations({ testMigration: { script: migrationScript, params: 'script' } });

  await s3().deleteObject({ Bucket: process.env.internal, Key }).promise();
  await s3().deleteBucket({ Bucket: process.env.internal }).promise();
});
