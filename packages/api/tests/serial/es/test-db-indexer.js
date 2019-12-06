'use strict';

const test = require('ava');
const rewire = require('rewire');
const aws = require('@cumulus/common/aws');
const attr = require('dynamodb-data-types').AttributeValue;
const { randomString } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/common/collection-config-store');

const models = require('../../../models');
const { Search } = require('../../../es/search');
const bootstrap = require('../../../lambdas/bootstrap');
const dbIndexer = rewire('../../../lambdas/db-indexer');
const {
  fakeCollectionFactory,
  fakeGranuleFactoryV2,
  fakeExecutionFactory,
  fakeFileFactory,
  deleteAliases
} = require('../../../lib/testUtils');

const { handler } = dbIndexer;

let esClient;
const esIndex = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.CollectionsTable = `${process.env.stackName}-CollectionsTable`;
process.env.GranulesTable = `${process.env.stackName}-GranulesTable`;
process.env.FilesTable = `${process.env.stackName}-FilesTable`;
process.env.ExecutionsTable = `${process.env.stackName}-ExecutionsTable`;
process.env.RulesTable = randomString();

const buildDynamoStreamRecord = ({
  eventName, tableName, keys, oldImage, newImage
}) => {
  const record = {
    eventID: '1',
    eventName,
    eventVersion: '1.0',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    eventSourceARN: `arn:aws:dynamodb:us-east-1:account-id:table/${tableName}/stream/2015-06-27T00:48:05.899`,
    dynamodb: {
      Keys: attr.wrap(keys),
      SequenceNumber: '1',
      SizeBytes: eventName === 'REMOVE' ? -1 : 1,
      StreamViewType: 'NEW_AND_OLD_IMAGES'
    }
  };

  if (['INSERT', 'MODIFY'].includes(eventName)) {
    record.dynamodb.NewImage = attr.wrap(newImage);
  }

  if (['MODIFY', 'REMOVE'].includes(eventName)) {
    record.dynamodb.OldImage = attr.wrap(oldImage);
  }

  return record;
};

const buildCollectionRecord = ({ type, oldCollection = null, newCollection = null }) => {
  let keys;
  if (type === 'REMOVE') {
    keys = {
      name: oldCollection.name,
      version: oldCollection.version
    };
  } else {
    keys = {
      name: newCollection.name,
      version: newCollection.version
    };
  }

  return buildDynamoStreamRecord({
    eventName: type,
    tableName: process.env.CollectionsTable,
    keys,
    oldImage: oldCollection,
    newImage: newCollection
  });
};

const buildExecutionRecord = ({ type, oldExecution = null, newExecution = null }) => {
  const arn = type === 'REMOVE' ? oldExecution.arn : newExecution.arn;

  return buildDynamoStreamRecord({
    eventName: type,
    tableName: process.env.ExecutionsTable,
    keys: { arn },
    oldImage: oldExecution,
    newImage: newExecution
  });
};

const buildGranuleRecord = ({ type, oldGranule = null, newGranule = null }) => {
  const granuleId = type === 'REMOVE' ? oldGranule.granuleId : newGranule.granuleId;

  return buildDynamoStreamRecord({
    eventName: type,
    tableName: process.env.GranulesTable,
    keys: { granuleId },
    oldImage: oldGranule,
    newImage: newGranule
  });
};

let collectionModel;
let executionModel;
let fileModel;
let granuleModel;
let ruleModel;
test.before(async () => {
  await deleteAliases();
  await aws.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  // create tables
  collectionModel = new models.Collection();
  granuleModel = new models.Granule();
  fileModel = new models.FileClass();
  executionModel = new models.Execution();
  ruleModel = new models.Rule();

  await Promise.all([
    collectionModel.createTable(),
    executionModel.createTable(),
    fileModel.createTable(),
    granuleModel.createTable(),
    ruleModel.createTable()
  ]);

  // bootstrap the esIndex
  esClient = await Search.es();
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);
  process.env.esIndex = esIndex;
});

test.after.always(async () => {
  await collectionModel.deleteTable();
  await granuleModel.deleteTable();
  await executionModel.deleteTable();
  await fileModel.deleteTable();
  await ruleModel.deleteTable();

  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);
  await esClient.indices.delete({ index: esIndex });
});

test.serial('create, update and delete a collection in dynamodb and es', async (t) => {
  const c = fakeCollectionFactory();

  const insertRecord = buildCollectionRecord({
    type: 'INSERT',
    newCollection: c
  });

  // fake the lambda trigger
  await handler({ Records: [insertRecord] });

  const collectionIndex = new Search({}, 'collection');
  let indexedRecord = await collectionIndex.get(constructCollectionId(c.name, c.version));

  t.is(indexedRecord.name, c.name);

  // change the record
  const modifyRecord = buildCollectionRecord({
    type: 'MODIFY',
    oldCollection: c,
    newCollection: { ...c, dataType: 'testing' }
  });

  // fake the lambda trigger
  await handler({ Records: [modifyRecord] });

  indexedRecord = await collectionIndex.get(constructCollectionId(c.name, c.version));
  t.is(indexedRecord.dataType, 'testing');

  // delete the record
  const removeRecord = buildCollectionRecord({
    type: 'REMOVE',
    oldCollection: { ...c, dataType: 'testing' }
  });

  // fake the lambda trigger
  await handler({ Records: [removeRecord] });

  const response = await collectionIndex.get(constructCollectionId(c.name, c.version));
  t.is(response.detail, 'Record not found');
});

test.serial('create, update and delete a granule in dynamodb and es', async (t) => {
  const fakeFile = fakeFileFactory();
  const fakeGranule = fakeGranuleFactoryV2({ files: [fakeFile] });

  const insertRecord = buildGranuleRecord({
    type: 'INSERT',
    newGranule: fakeGranule
  });

  // fake the lambda trigger
  await handler({ Records: [insertRecord] });

  const granuleIndex = new Search({}, 'granule');
  let indexedRecord = await granuleIndex.get(fakeGranule.granuleId);

  t.is(indexedRecord.granuleId, fakeGranule.granuleId);

  // make sure all the file records are added
  const record = await fileModel.get({ bucket: fakeFile.bucket, key: fakeFile.key });
  t.is(record.bucket, fakeFile.bucket);
  t.is(record.key, fakeFile.key);
  t.is(record.granuleId, fakeGranule.granuleId);

  // change the record
  const modifyRecord = buildGranuleRecord({
    type: 'MODIFY',
    oldGranule: fakeGranule,
    newGranule: { ...fakeGranule, status: 'failed' }
  });

  // fake the lambda trigger
  await handler({ Records: [modifyRecord] });

  indexedRecord = await granuleIndex.get(fakeGranule.granuleId);
  t.is(indexedRecord.status, 'failed');

  // delete the record
  const removeRecord = buildGranuleRecord({
    type: 'REMOVE',
    oldGranule: { ...fakeGranule, status: 'failed' }
  });

  // fake the lambda trigger
  await handler({ Records: [removeRecord] });

  indexedRecord = await granuleIndex.get(fakeGranule.granuleId);
  t.is(indexedRecord.detail, 'Record not found');

  // make sure the file records are deleted
  await t.throwsAsync(
    () => fileModel.get({ bucket: fakeFile.bucket, key: fakeFile.key }),
    /No record/
  );

  const deletedGranIndex = new Search({}, 'deletedgranule');
  const deletedGranRecord = await deletedGranIndex.get(fakeGranule.granuleId);
  t.is(deletedGranRecord.granuleId, fakeGranule.granuleId);
});

test.serial('create, update and delete an execution in dynamodb and es', async (t) => {
  const fakeRecord = fakeExecutionFactory();

  const insertRecord = buildExecutionRecord({
    type: 'INSERT',
    newExecution: fakeRecord
  });

  // fake the lambda trigger
  await handler({ Records: [insertRecord] });

  const recordIndex = new Search({}, 'execution');
  let indexedRecord = await recordIndex.get(fakeRecord.arn);

  t.is(indexedRecord.arn, fakeRecord.arn);

  // change the record
  const modifyRecord = buildExecutionRecord({
    type: 'MODIFY',
    oldExecution: fakeRecord,
    newExecution: { ...fakeRecord, status: 'failed' }
  });

  // fake the lambda trigger
  await handler({ Records: [modifyRecord] });

  indexedRecord = await recordIndex.get(fakeRecord.arn);
  t.is(indexedRecord.status, 'failed');

  // delete the record
  const removeRecord = buildExecutionRecord({
    type: 'REMOVE',
    oldExecution: { ...fakeRecord, status: 'failed' }
  });

  // fake the lambda trigger
  await handler({ Records: [removeRecord] });

  indexedRecord = await recordIndex.get(fakeRecord.arn);
  t.is(indexedRecord.detail, 'Record not found');
});

test.serial('The db-indexer does not throw an exception when execution fails', async (t) => {
  const insertRecord = buildExecutionRecord({
    type: 'INSERT',
    newExecution: fakeExecutionFactory()
  });

  // fake the lambda trigger
  await t.notThrowsAsync(
    dbIndexer.__with__({
      indexer: {
        indexExecution: () => Promise.reject(new Error('oh no'))
      }
    })(() => handler({ Records: [insertRecord] }))
  );
});
