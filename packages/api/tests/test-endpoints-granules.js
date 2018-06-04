'use strict';

const sinon = require('sinon');
const test = require('ava');
const aws = require('@cumulus/common/aws');
const { StepFunction } = require('@cumulus/ingest/aws');
const { CMR } = require('@cumulus/cmrjs');
const { DefaultProvider } = require('@cumulus/ingest/crypto');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../models');
const bootstrap = require('../lambdas/bootstrap');
const granuleEndpoint = require('../endpoints/granules');
const indexer = require('../es/indexer');
const { testEndpoint, fakeGranuleFactory } = require('../lib/testUtils');
const { Search } = require('../es/search');

// create all the variables needed across this test
let esClient;
let fakeGranules;
const hash = { name: 'granuleId', type: 'S' };
const esIndex = randomString();
process.env.GranulesTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();
const g = new models.Granule();

test.before(async () => {
  // create esClient
  esClient = await Search.es('fakehost');

  // add fake elasticsearch index
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  // create a fake bucket
  await aws.s3().createBucket({ Bucket: process.env.internal }).promise();

  // create fake granule table
  await models.Manager.createTable(process.env.GranulesTable, hash);

  // create fake granule records
  fakeGranules = ['completed', 'failed'].map(fakeGranuleFactory);
  await Promise.all(fakeGranules.map((granule) => g.create(granule)
    .then((record) => indexer.indexGranule(esClient, record, esIndex))));
});

test.after.always(async () => {
  await Promise.all([
    models.Manager.deleteTable(process.env.GranulesTable),
    esClient.indices.delete({ index: esIndex }),
    aws.recursivelyDeleteS3Bucket(process.env.internal)
  ]);
});


test('default returns list of granules', (t) => {
  const listEvent = { httpMethod: 'list' };
  return testEndpoint(granuleEndpoint, listEvent, (response) => {
    const { meta, results } = JSON.parse(response.body);
    t.is(results.length, 2);
    t.is(meta.stack, process.env.stackName);
    t.is(meta.table, 'granule');
    t.is(meta.count, 2);
    const granuleIds = fakeGranules.map((i) => i.granuleId);
    results.forEach((r) => {
      t.true(granuleIds.includes(r.granuleId));
    });
  });
});

test('GET returns an existing granule', (t) => {
  const getEvent = {
    httpMethod: 'GET',
    pathParameters: {
      granuleName: fakeGranules[0].granuleId
    }
  };
  return testEndpoint(granuleEndpoint, getEvent, (response) => {
    const { granuleId } = JSON.parse(response.body);
    t.is(granuleId, fakeGranules[0].granuleId);
  });
});

test('GET fails if granule is not found', async (t) => {
  const event = {
    httpMethod: 'GET',
    pathParameters: {
      granuleName: 'unknownGranule'
    }
  };

  const response = await testEndpoint(granuleEndpoint, event, (r) => r);
  t.is(response.statusCode, 400);
  const { message } = JSON.parse(response.body);
  t.true(message.includes('No record found for'));
});

test('PUT fails if action is not supported', async (t) => {
  const event = {
    httpMethod: 'PUT',
    pathParameters: {
      granuleName: fakeGranules[0].granuleId
    },
    body: '{"action":"reprocess"}'
  };

  const response = await testEndpoint(granuleEndpoint, event, (r) => r);
  t.is(response.statusCode, 400);
  const { message } = JSON.parse(response.body);
  t.true(message.includes('Action is not supported'));
});

test('PUT fails if action is not provided', async (t) => {
  const event = {
    httpMethod: 'PUT',
    pathParameters: {
      granuleName: fakeGranules[0].granuleId
    }
  };

  const response = await testEndpoint(granuleEndpoint, event, (r) => r);
  t.is(response.statusCode, 400);
  const { message } = JSON.parse(response.body);
  t.is(message, 'Action is missing');
});

test('reingest a granule', async (t) => {
  const fakeSFResponse = {
    execution: {
      input: JSON.stringify({
        meta: {
          workflow_name: 'IngestGranule'
        },
        payload: {}
      })
    }
  };

  const event = {
    httpMethod: 'PUT',
    pathParameters: {
      granuleName: fakeGranules[0].granuleId
    },
    body: '{"action":"reingest"}'
  };

  // fake workflow
  process.env.bucket = process.env.internal;
  const payload = JSON.parse(fakeSFResponse.execution.input);
  const key = `${process.env.stackName}/workflows/${payload.meta.workflow_name}.json`;
  await aws.s3().putObject({ Bucket: process.env.bucket, Key: key, Body: 'test data' }).promise();

  sinon.stub(
    StepFunction,
    'getExecutionStatus'
  ).callsFake(() => Promise.resolve(fakeSFResponse));

  await testEndpoint(granuleEndpoint, event, (response) => {
    const body = JSON.parse(response.body);
    t.is(body.status, 'SUCCESS');
    t.is(body.action, 'reingest');
    return response;
  });

  const updatedGranule = await g.get({ granuleId: fakeGranules[0].granuleId });
  t.is(updatedGranule.status, 'running');

  StepFunction.getExecutionStatus.restore();
});


test('remove a granule from CMR', async (t) => {
  const event = {
    httpMethod: 'PUT',
    pathParameters: {
      granuleName: fakeGranules[0].granuleId
    },
    body: '{"action":"removeFromCmr"}'
  };

  sinon.stub(
    DefaultProvider,
    'decrypt'
  ).callsFake(() => Promise.resolve('fakePassword'));

  sinon.stub(
    CMR.prototype,
    'deleteGranule'
  ).callsFake(() => Promise.resolve());

  await testEndpoint(granuleEndpoint, event, (response) => {
    const body = JSON.parse(response.body);
    t.is(body.status, 'SUCCESS');
    t.is(body.action, 'removeFromCmr');
    return response;
  });

  const updatedGranule = await g.get({ granuleId: fakeGranules[0].granuleId });
  t.is(updatedGranule.published, false);
  t.is(updatedGranule.cmrLink, null);

  CMR.prototype.deleteGranule.restore();
  DefaultProvider.decrypt.restore();
});

test('DELETE deleting an existing granule that is published will fail', async (t) => {
  const deleteEvent = {
    httpMethod: 'DELETE',
    pathParameters: {
      granuleName: fakeGranules[1].granuleId
    }
  };
  const response = await testEndpoint(granuleEndpoint, deleteEvent, (r) => r);
  t.is(response.statusCode, 400);
  const { message } = JSON.parse(response.body);
  t.is(
    message,
    'You cannot delete a granule that is published to CMR. Remove it from CMR first'
  );
});

test('DELETE deleting an existing unpublished granule', async (t) => {
  const newGranule = fakeGranuleFactory('failed');
  newGranule.published = false;
  // create a new unpublished granule
  await g.create(newGranule);

  const deleteEvent = {
    httpMethod: 'DELETE',
    pathParameters: {
      granuleName: newGranule.granuleId
    }
  };

  const key = `${process.env.stackName}/granules_ingested/${newGranule.granuleId}`;
  await aws.s3().putObject({ Bucket: process.env.internal, Key: key, Body: 'test data' }).promise();

  const response = await testEndpoint(granuleEndpoint, deleteEvent, (r) => r);
  t.is(response.statusCode, 200);
  const { detail } = JSON.parse(response.body);
  t.is(
    detail,
    'Record deleted'
  );
});

test('move a granule', async (t) => {
  const bucket = process.env.internal;
  const secondBucket = randomString();
  await aws.s3().createBucket({ Bucket: secondBucket }).promise();
  const newGranule = fakeGranuleFactory();

  newGranule.files = [
    {
      bucket,
      name: `${newGranule.granuleId}.txt`,
      filepath: `${process.env.stackName}/granules_ingested/${newGranule.granuleId}.txt`
    },
    {
      bucket,
      name: `${newGranule.granuleId}.md`,
      filepath: `${process.env.stackName}/granules_ingested/${newGranule.granuleId}.md`
    },
    {
      bucket: secondBucket,
      name: `${newGranule.granuleId}.jpg`,
      filepath: `${process.env.stackName}/granules_ingested/${newGranule.granuleId}.jpg`
    }
  ];

  await g.create(newGranule);

  await Promise.all(newGranule.files.map(async (file) => {
    aws.s3().putObject({ Bucket: file.bucket, Key: file.filepath, Body: 'test data' }).promise();
  }));

  const destinationFilepath = `${process.env.stackName}/granules_moved`;
  const destinations = [
    {
      regex: '.*.txt$',
      bucket,
      filepath: destinationFilepath
    },
    {
      regex: '.*.md$',
      bucket,
      filepath: destinationFilepath
    },
    {
      regex: '.*.jpg$',
      bucket: secondBucket,
      filepath: destinationFilepath
    }
  ];

  const moveEvent = {
    httpMethod: 'PUT',
    pathParameters: {
      granuleName: newGranule.granuleId
    },
    body: JSON.stringify({
      action: 'move',
      destinations
    })
  };

  await testEndpoint(granuleEndpoint, moveEvent, async (response) => {
    const body = JSON.parse(response.body);
    t.is(body.status, 'SUCCESS');
    t.is(body.action, 'move');

    await aws.s3().listObjects({ Bucket: bucket, Prefix: destinationFilepath }).promise().then((list) => {
      t.is(list.Contents.length, 2);

      list.Contents.forEach((item) => {
        t.is(item.Key.indexOf(destinationFilepath), 0);
      });
    });

    return aws.s3().listObjects({ Bucket: secondBucket, Prefix: destinationFilepath }).promise().then((list) => {
      t.is(list.Contents.length, 1);

      list.Contents.forEach((item) => {
        t.is(item.Key.indexOf(destinationFilepath), 0);
      });
    });
  });
});
