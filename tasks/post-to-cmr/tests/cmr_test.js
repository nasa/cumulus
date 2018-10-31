'use strict';

const fs = require('fs');
const test = require('ava');
const sinon = require('sinon');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

const cmrjs = require('@cumulus/cmrjs');
const payload = require('./data/payload.json');
const { postToCMR } = require('..');

const result = {
  'concept-id': 'testingtesging'
};

async function deleteBucket(bucket) {
  const response = await aws.s3().listObjects({ Bucket: bucket }).promise();
  const keys = response.Contents.map((o) => o.Key);
  await Promise.all(keys.map(
    (key) => aws.s3().deleteObject({ Bucket: bucket, Key: key }).promise()
  ));
}

test.beforeEach((t) => {
  t.context.bucket = randomString();

  //update cmr file path
  const match = /^s3\:\/\/(.*)\/(.*)$/;
  const cmrFile = payload.input.granules[0].files[3].filename;
  payload.input.granules[0].files[3].filename = `s3://${t.context.bucket}/${match.exec(cmrFile)[2]}`;
  payload.input.granules[0].files[3].bucket = t.context.bucket;

  return aws.s3().createBucket({ Bucket: t.context.bucket }).promise();
});

test.afterEach.always(async (t) => {
  deleteBucket(t.context.bucket);
});

test.serial('postToCMR throws error if CMR correctly identifies the xml as invalid', async (t) => {
  sinon.stub(cmrjs.CMR.prototype, 'getToken');

  const newPayload = JSON.parse(JSON.stringify(payload));
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
  catch (e) {
    t.true(e instanceof cmrjs.ValidationError);
  }
  finally {
    cmrjs.CMR.prototype.getToken.restore();
  }
});

test.serial('postToCMR succeeds with correct payload', async (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
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
      `https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=${result['concept-id']}`
    );
  }
  finally {
    cmrjs.CMR.prototype.ingestGranule.restore();
  }
});

test.serial('postToCMR returns SIT url when CMR_ENVIRONMENT=="SIT"', async (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  const newPayload = JSON.parse(JSON.stringify(payload));
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

test.serial('postToCMR skips CMR step if the metadata file uri is missing', async (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  newPayload.input.granules = [{
    granuleId: 'some granule',
    files: [{
      filename: `s3://${t.context.bucket}/to/file.xml`
    }]
  }];

  const output = await postToCMR(newPayload);
  t.is(output.granules[0].cmr, undefined);
});
