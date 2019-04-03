'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const sinon = require('sinon');
const { promisify } = require('util');

const cmrjs = require('@cumulus/cmrjs');
const cmrClient = require('@cumulus/cmr-client');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const { CMRMetaFileNotFound } = require('@cumulus/common/errors');

const { postToCMR } = require('..');

const readFile = promisify(fs.readFile);

const result = {
  'concept-id': 'testingtesting'
};

test.beforeEach(async (t) => {
  t.context.bucket = randomString();

  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = await readFile(payloadPath, 'utf8');
  const payload = JSON.parse(rawPayload);
  t.context.payload = payload;

  //update cmr file path
  const match = /^s3\:\/\/(.*)\/(.*)$/;
  const cmrFile = payload.input.granules[0].files[3].filename;
  payload.input.granules[0].files[3].filename = `s3://${t.context.bucket}/${match.exec(cmrFile)[2]}`;
  payload.input.granules[0].files[3].bucket = t.context.bucket;

  return aws.s3().createBucket({ Bucket: t.context.bucket }).promise();
});

test.afterEach.always((t) => aws.recursivelyDeleteS3Bucket(t.context.bucket));

test.serial('postToCMR throws error if CMR correctly identifies the xml as invalid', async (t) => {
  sinon.stub(cmrClient.CMR.prototype, 'getToken');

  const newPayload = t.context.payload;

  const granuleId = newPayload.input.granules[0].granuleId;
  const key = `${granuleId}.cmr.xml`;

  try {
    await aws.promiseS3Upload({
      Bucket: t.context.bucket,
      Key: key,
      Body: '<?xml version="1.0" encoding="UTF-8"?><results></results>'
    });
    await postToCMR(newPayload);
    t.fail();
  }
  catch (error) {
    t.true(error instanceof cmrClient.ValidationError);
  }
  finally {
    cmrClient.CMR.prototype.getToken.restore();
  }
});

test.serial('postToCMR succeeds with correct payload', async (t) => {
  const newPayload = t.context.payload;

  sinon.stub(cmrjs.CMR.prototype, 'ingestGranule').callsFake(() => ({
    result
  }));
  const granuleId = newPayload.input.granules[0].granuleId;
  const key = `${granuleId}.cmr.xml`;

  try {
    await aws.promiseS3Upload({
      Bucket: t.context.bucket,
      Key: key,
      Body: fs.createReadStream(path.join(path.dirname(__filename), 'data', 'meta.xml'))
    });
    const output = await postToCMR(newPayload);
    t.is(
      output.granules[0].cmrLink,
      `https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=${result['concept-id']}`
    );
  }
  finally {
    cmrjs.CMR.prototype.ingestGranule.restore();
  }
});

test.serial('postToCMR returns SIT url when CMR_ENVIRONMENT=="SIT"', async (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';

  const newPayload = t.context.payload;

  sinon.stub(cmrjs.CMR.prototype, 'ingestGranule').callsFake(() => ({
    result
  }));
  const granuleId = newPayload.input.granules[0].granuleId;
  const key = `${granuleId}.cmr.xml`;

  try {
    await aws.promiseS3Upload({
      Bucket: t.context.bucket,
      Key: key,
      Body: fs.createReadStream('tests/data/meta.xml')
    });
    const output = await postToCMR(newPayload);
    t.is(
      output.granules[0].cmrLink,
      `https://cmr.sit.earthdata.nasa.gov/search/granules.json?concept_id=${result['concept-id']}`
    );
  }
  finally {
    cmrjs.CMR.prototype.ingestGranule.restore();
    delete process.env.CMR_ENVIRONMENT;
  }
});

test.serial('postToCMR throws an error if there is no CMR Meta file', async (t) => {
  const newPayload = t.context.payload;

  newPayload.input.granules = [{
    granuleId: 'some granule',
    files: [{
      filename: `s3://${t.context.bucket}/to/file.xml`
    }]
  }];

  try {
    await postToCMR(newPayload);
  }
  catch (error) {
    t.true(error instanceof CMRMetaFileNotFound);
  }
});

test.serial('postToCMR throws an error if any granule is missing a Meta file', async (t) => {
  const newPayload = t.context.payload;
  const newGranule = {
    granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090555',
    files: [{
      filename: `s3://${t.context.bucket}/to/file.xml`
    }]
  };
  newPayload.input.granules.push(newGranule);

  try {
    await postToCMR(newPayload);
  }
  catch (error) {
    t.true(error instanceof CMRMetaFileNotFound);
    t.is(error.message, (`CMR Meta file not found for granule ${newGranule.granuleId}`));
  }
});

test.serial('postToCMR continues without Meta file if there is metaCheck flag', async (t) => {
  const newPayload = t.context.payload;
  const newGranule = [{
    granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090555',
    files: [{
      filename: `s3://${t.context.bucket}/to/file.xml`
    }]
  }];
  newPayload.input.granules = newGranule;
  newPayload.config.metaCheck = true;
  const granuleId = newPayload.input.granules[0].granuleId;
  const key = `${granuleId}.cmr.xml`;

  sinon.stub(cmrjs.CMR.prototype, 'ingestGranule').callsFake(() => ({
    result
  }));
  try {
    await aws.promiseS3Upload({
      Bucket: t.context.bucket,
      Key: key,
      Body: fs.createReadStream('tests/data/meta.xml')
    });
    const output = await postToCMR(newPayload);
    t.is(output.granules[0].granuleId, granuleId);
  }
  finally {
    cmrjs.CMR.prototype.ingestGranule.restore();
  }
});

test.serial('postToCmr identifies files with the new file schema', async (t) => {
  const newPayload = t.context.payload;
  const cmrFile = newPayload.input.granules[0].files[3];
  newPayload.input.granules[0].files = [{
    bucket: t.context.bucket,
    key: `path/${cmrFile.name}`,
    fileName: cmrFile.name
  }];

  sinon.stub(cmrjs.CMR.prototype, 'ingestGranule').callsFake(() => ({
    result
  }));

  try {
    await aws.promiseS3Upload({
      Bucket: t.context.bucket,
      Key: `path/${cmrFile.name}`,
      Body: fs.createReadStream('tests/data/meta.xml')
    });
    const output = await postToCMR(newPayload);
    t.is(
      output.granules[0].cmrLink,
      `https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=${result['concept-id']}`
    );
  }
  finally {
    cmrjs.CMR.prototype.ingestGranule.restore();
  }
});
