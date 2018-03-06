'use strict';

const archiver = require('archiver');
const aws = require('@cumulus/common/aws');
const fs = require('fs');
const path = require('path');
const { randomString } = require('@cumulus/common/test-utils');
const test = require('ava');

process.env.stackName = 'test-stack';
process.env.internal = 'test-bucket';
process.env.CollectionsTable = `${process.env.stackName}-CollectionsTable`;

const bootstrap = require('../lambdas/bootstrap');
const models = require('../models');
const collections = new models.Collection();
const EsCollection = require('../es/collections');

const testCollection = {
  'name': `collection-${randomString()}`,
  'version': '0.0.0',
  'provider_path': '/',
  'duplicateHandling': 'replace',
  'granuleId': '^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
  'granuleIdExtraction': '(MOD09GQ\\.(.*))\\.hdf',
  'sampleFileName': 'MOD09GQ.A2017025.h21v00.006.2017034065104.hdf',
  'files': []
};

const codeDirectory = 'dist/'
const tmpZipFile = path.join('/tmp/test.zip');
const output = fs.createWriteStream(tmpZipFile)
const archive = archiver('zip', {
  zlib: { level: 9 }
});
const dbIndexerFnName = 'test-dbIndexer';
const hash = { name: 'name', type: 'S' };

/**
 * TODO(aimee): This test works locally but not on CI. Running localstack on CI for this test requires:
 * - built packages/api/dist/index.js (packages are not built for circle ci). This is fixable.
 * - A docker executor for lambdas, which is done in part by LAMBDA_EXECUTOR: docker as an env variable to the localstack/localstack docker image for ci
 *   But it still appears docker isn't running: `Cannot connect to the Docker daemon at unix:///var/run/docker.sock`
**/
if (process.env.IS_LOCAL === 'true') {
  // Test that if our dynamos are hooked up to the db-indexer lambda function,
  // records show up in elasticsearch 'hooked-up': the dynamo has a stream and the
  // lambda has an event source mapping to that dynamo stream.
  test.before(async () => {
    await aws.s3().createBucket({ Bucket: process.env.internal }).promise();

    // create collections table
    await models.Manager.createTable(process.env.CollectionsTable, hash);
    await bootstrap.bootstrapElasticSearch('http://localhost:4571');

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
          },
          Environment: {
            Variables: {
              'TEST': 'true',
              'LOCALSTACK_HOST': process.env.DOCKERHOST
            }
          }
        })
        .promise()
        .then((res) => {
          fs.unlinkSync(tmpZipFile);
          resolve(res);
        });
      });

      archive.pipe(output)
      archive.directory(codeDirectory, false);
      archive.finalize()
    })
    .catch(e => console.log(e));

    //get the dynamo collections table stream arn and add it as an event source to the lambda
    await new Promise((resolve, reject) => {
      aws.dynamodbstreams().listStreams({TableName: process.env.CollectionsTable}, (err, data) => {
        if (err) reject(err);
        const collectionsTableStreamArn = data.Streams.find(s => s.TableName === 'test-stack-CollectionsTable').StreamArn;
        const eventSourceMappingParams = {
          EventSourceArn: collectionsTableStreamArn,
          FunctionName: dbIndexerFnName,
          StartingPosition: 'TRIM_HORIZON',
          BatchSize: 10
        };

        aws.lambda().createEventSourceMapping(eventSourceMappingParams, (err, data) => {
          if (err) reject(err);
          resolve(data);
        });
      });
    })
    .catch(e => console.log(e));
  });

  test.after.always(async () => {
    await models.Manager.deleteTable(process.env.CollectionsTable);
    await aws.lambda().deleteFunction({FunctionName: dbIndexerFnName}).promise();
    await aws.recursivelyDeleteS3Bucket(process.env.internal);
  });

  test('creates a collection in dynamodb and es', async t => {
    return await collections.create(testCollection)
      .then(() => {
        const esCollection = new EsCollection({});
        return esCollection.query();
      })
      .then((result) => {
        // search is limited to returning 1 result at the moment, which is
        // strange, so just check for name here.
        t.is(result.results[0].name, testCollection.name);
        t.is(result.results[0].version, testCollection.version);
      })
      .catch(e => console.log(e));
  });
}
