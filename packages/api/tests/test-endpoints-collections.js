'use strict';

const test = require('ava');

// TODO(aimee): Dry this setup for all api package tests.
process.env.CollectionsTable = 'Test_CollectionsTable';
process.env.stackName = 'test-stack';
process.env.internal = 'test-bucket';

const models = require('../models');
const aws = require('@cumulus/common/aws');
const collectionsEndpoint = require('../endpoints/collections');
const collections = new models.Collection();

const testCollection = {
  "name": "collection-125",
  "version": "0.0.0",
  "provider_path": "/",
  "duplicateHandling": "replace",
  "granuleId": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$",
  "granuleIdExtraction": "(MOD09GQ\\.(.*))\\.hdf",
  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",
  "files": []
};

const hash = { name: 'name', type: 'S' };
async function setup() {
  await aws.s3().createBucket({ Bucket: process.env.internal }).promise();
  await models.Manager.createTable(process.env.CollectionsTable, hash);
  await collections.create(testCollection);
}

async function teardown() {
  models.Manager.deleteTable(process.env.CollectionsTable);
  await aws.recursivelyDeleteS3Bucket(process.env.internal);
}

test.before(async () => setup());
test.after.always(async () => teardown());

test('default returns list of collections', t => {
  return new Promise((resolve, reject) => {
    collectionsEndpoint(
      {
        httpMethod: 'list'
      },
      {
        succeed: (r) => resolve(t.is(JSON.parse(r.body).Items.length, 1)),
        fail: (e) => reject(e)
      }
    )     
  });
});

test('POST creates a new collection', t => {
  const newCollection = Object.assign({}, testCollection, {name: 'collection-post'});
  return new Promise((resolve, reject) => {
    collectionsEndpoint(
      {
        httpMethod: 'POST',
        body: JSON.stringify(newCollection)
      },
      {
        succeed: (r) => {
          const { message, record } = JSON.parse(r.body);
          t.is(message, 'Record saved');
          t.is(record.name, newCollection.name);
          resolve();
        },
        fail: (e) => reject(e)
      }
    )
  });
});

test('PUT updates an existing collection', t => {
  const newPath = '/new_path';
  const updateEvent = {
    body: JSON.stringify({
      name: testCollection.name,
      version: testCollection.version,
      provider_path: newPath
    }),
    pathParameters: {
      collectionName: testCollection.name,
      version: testCollection.version,
    },
    httpMethod: 'PUT'
  };
  return new Promise((resolve, reject) => {
    collectionsEndpoint(
      updateEvent,
      {
        succeed: (r) => {
          console.log(r);
          const record = JSON.parse(r.body);
          t.is(record.provider_path, newPath);
          resolve();
        },
        fail: (e) => reject(e)
      }
    )
  });
});

test('DELETE deletes an existing collection', t => {
  const deleteEvent = {
    httpMethod: 'DELETE',
    pathParameters: {
      collectionName: testCollection.name,
      version: testCollection.version,
    }
  };
  return new Promise((resolve, reject) => {
    collectionsEndpoint(
      deleteEvent,
      {
        succeed: (r) => {
          const { message } = JSON.parse(r.body);
          t.is(message, 'Record deleted');
          resolve();
        },
        fail: (e) => reject(e)
      }
    )
  });
});

test.todo('GET returns existing collection');
test.todo('POST without name and version returns error message');
test.todo('PUT with invalid name and version returns error message');
// Multiple tests
test.todo('Test methods return not found');
