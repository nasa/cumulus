#!/usr/bin/env node
'use strict';

process.env.TEST = true;
process.env.LOCALSTACK_HOST = 'localhost';
process.env.CollectionsTable = 'Test_CollectionsTable';

const bootstrap = require('../lambdas/bootstrap');
const Collection = require('../es/collections');
const { indexCollection } = require('../es/indexer');
const models = require('../models');
const { Search } = require('../es/search');

const testCollection = {
  'name': 'collection-125',
  'version': '0.0.0',
  'provider_path': '/',
  'duplicateHandling': 'replace',
  'granuleId': '^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
  'granuleIdExtraction': '(MOD09GQ\\.(.*))\\.hdf',
  'sampleFileName': 'MOD09GQ.A2017025.h21v00.006.2017034065104.hdf',
  'files': []
};
const event = {};
const res = {
  name: testCollection.name,
  version: testCollection.version
}
//bootstrap.bootstrapElasticSearch('http://localhost:4571');

async function testIndexCollection() {
  const esClient = await Search.es();
  const collections = new models.Collection();
  const hash = { name: 'name', type: 'S' };

  await collections.create(testCollection)
    .then(() => bootstrap.bootstrapElasticSearch('http://localhost:4571'))
    .then(() => indexCollection(esClient, testCollection))
    //.then(result => console.log(result))
    .then(() => collections.get({name: testCollection.name}))
    .then(result => {
      console.log(result)
      const collection = new Collection({});
      return collection.query();
    })
    .then(result => console.log(result))
    .catch(e => console.log(e));
  // await esClient.indices.delete({index: 'cumulus'})
  //   .then(body => {
  //     console.log(body);
  //     return;
  //   });
     
}
testIndexCollection();
