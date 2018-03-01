#!/usr/bin/env node

// TEST=true IS_LOCAL=true LOCALSTACK_HOST=localhost tests/test-db-indexer.js

const { randomString } = require('@cumulus/common/test-utils');

process.env.CollectionsTable = `CollectionsTable_${randomString()}`;
process.env.stackName = 'my-stackName';
process.env.internal = 'my-bucket';

const models = require('../models');
const aws = require('@cumulus/common/aws');
const collectionsEndpoint = require('../endpoints/collections');

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
async function createTable() {
  await aws.s3().createBucket({ Bucket: process.env.internal }).promise();
  await models.Manager.createTable(process.env.CollectionsTable, hash);
}

function processResponse(r) {
  return console.log(JSON.parse(r.body).Items);
}

const collections = new models.Collection();
createTable().then(() => {
  console.log('table created')
  return collections.create(testCollection)
    .then(coll => {
      return collections.get({name: testCollection.name});
    })
    .then(async () => {
      return await collectionsEndpoint(
        {
          httpMethod: 'list'
        },
        {
          succeed: (r) => processResponse(r)
        });
    })
    .catch(e => console.log(e.stack));
});
