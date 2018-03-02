'use strict';

const test = require('ava');

process.env.CollectionsTable = 'Test_CollectionsTable';
process.env.stackName = 'my-stackName';
process.env.internal = 'my-bucket';

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
}

async function teardown() {
  models.Manager.deleteTable(process.env.CollectionsTable);
  await aws.recursivelyDeleteS3Bucket(process.env.internal);
}

test.before(async () => setup());
test.after.always(async () => teardown());

test('returns list of collections', async t => {
  return collections.create(testCollection)
    .then(coll => collections.get({name: testCollection.name}))
    .then(async () => {
      return await new Promise((resolve, reject) => {
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
});
