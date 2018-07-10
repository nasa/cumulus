'use strict';

const test = require('ava');
const drop = require('lodash.drop');
const clone = require('lodash.clonedeep');
const models = require('../models');
const { fakeGranuleFactory, fakeFilesFactory } = require('../lib/testUtils');
const { randomString } = require('@cumulus/common/test-utils');

process.env.stackName = randomString();
process.env.FilesTable = randomString();
const fileModel = new models.FileClass();

test.before(async () => {
  await fileModel.createTable();
});

test.after.always(async () => {
  // cleanup table
  await models.Manager.deleteTable(process.env.FilesTable);
});

test.serial('create files records from a granule and then delete them', async (t) => {
  const bucket = randomString();
  const granule = fakeGranuleFactory();
  granule.files = [];
  for (let i = 0; i < 27; i += 1) {
    granule.files.push(fakeFilesFactory(bucket));
  }

  await fileModel.createFilesFromGranule(granule);

  // make sure all the records are added
  await Promise.all(granule.files.map(async (file) => {
    const record = await fileModel.get({ bucket, key: file.filepath });
    t.is(record.bucket, file.bucket);
    t.is(record.key, file.filepath);
    t.is(record.granuleId, granule.granuleId);
  }));

  await fileModel.deleteFilesOfGranule(granule);

  await Promise.all(granule.files.map(async (file) => {
    const promise = fileModel.get({ bucket, key: file.filepath });
    const err = await t.throws(promise);
    t.true(err.message.includes('No record'));
  }));
});


test.serial('create a granule with 4 files, then remove one of the files', async (t) => {
  const bucket = randomString();
  const granule = fakeGranuleFactory();
  granule.files = [];
  for (let i = 0; i < 4; i += 1) {
    granule.files.push(fakeFilesFactory(bucket));
  }

  await fileModel.createFilesFromGranule(granule);

  const newGranule = clone(granule);
  const droppedFile = granule.files[0];
  newGranule.files = drop(granule.files);

  await fileModel.deleteFilesAfterCompare(newGranule, granule);

  // make sure all the records are added
  await Promise.all(newGranule.files.map(async (file) => {
    const record = await fileModel.get({ bucket, key: file.filepath });
    t.is(record.bucket, file.bucket);
    t.is(record.key, file.filepath);
    t.is(record.granuleId, granule.granuleId);
  }));

  // make sure the droppedFile is deleted
  const promise = fileModel.get({ bucket: bucket, key: droppedFile.filepath });
  const err = await t.throws(promise);
  t.true(err.message.includes('No record'));
});
