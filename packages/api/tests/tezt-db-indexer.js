#!/usr/bin/env node
'use strict';

const fs = require('fs');
const archiver = require('archiver');
const path = require('path');

process.env.LOCALSTACK_HOST='localhost'
process.env.IS_LOCAL = true
process.env.TEST = true
process.env.CollectionsTable = 'Test_CollectionsTable';
process.env.stackName = 'test-stack';
process.env.internal = 'test-bucket';

const models = require('../models');
const aws = require('@cumulus/common/aws');
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

const codeDirectory = 'dist/'
const tmpZipFile = path.join('test.zip');
const output = fs.createWriteStream(tmpZipFile)
const archive = archiver('zip', {
  zlib: { level: 9 } // Sets the compression level.
});
const dbIndexerFnName = 'test-dbIndexer';

// Test that if our dynamos are hooked up to the db-indexer lambda function,
// records show up in elasticsearch 'hooked-up': the dynamo has a stream and the
// lambda has an event source mapping to that dynamo stream.
async function setup() {
  await aws.s3().createBucket({ Bucket: process.env.internal }).promise();

  const hash = { name: 'name', type: 'S' };
  // create collections table
  await models.Manager.createTable(process.env.CollectionsTable, hash);

  // create the lambda function
  await new Promise((resolve) => {
    output.on('close', () => {
      const contents = fs.readFileSync(tmpZipFile)

      aws.lambda().createFunction({
        FunctionName: dbIndexerFnName,
        Runtime: 'nodejs6.10',
        Handler: 'index.dbIndexer', // point to the db indexer
        Role: 'testRole',
        Code: {
          ZipFile: contents
        }
      })
      .promise()
      .then(res => {
        fs.unlinkSync(tmpZipFile);
        resolve(res);
      });
    });

    archive.pipe(output)
    archive.directory(codeDirectory, false);
    archive.finalize()
  })
  .catch(e => console.log(e));

  // get the dynamo collections table stream arn and add it as an event source to the lambda
  await aws.dynamodb().describeTable({TableName: process.env.CollectionsTable}).promise()
    .then(res => {
      const collectionsTableStreamArn = res.Table.LatestStreamArn;
      const eventSourceMappingParams = {
        EventSourceArn: collectionsTableStreamArn,
        FunctionName: dbIndexerFnName,
        StartingPosition: 'TRIM_HORIZON',
        BatchSize: 10
      };
      return aws.lambda().createEventSourceMapping(eventSourceMappingParams)
        .promise();
    })
    .catch(e => console.log(e));

  await aws.recursivelyDeleteS3Bucket(process.env.internal);
}

async function teardown() {
  await models.Manager.deleteTable(process.env.CollectionsTable);
  await aws.lambda().deleteFunction({FunctionName: dbIndexerFnName})
    .promise()
    .catch(e => console.log(e));
}

async function testEs() {
  return await collections.create(testCollection)
    .then(collection => collections.get({name: testCollection.name}))
    .then(res => console.log(res)) 
    .catch(e => console.log(e))
}

setup()
  .then(testEs())
  .then(teardown())
  .catch(e => console.log(e));
