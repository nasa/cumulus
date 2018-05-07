'use strict';

const fs = require('fs');
const test = require('ava');
const sinon = require('sinon');
const aws = require('@cumulus/common/aws');

const cmrjs = require('@cumulus/cmrjs');
const payload = require('./data/payload.json');
const { postToCMR } = require('../index');

const result = {
  'concept-id': 'testingtesging'
};

// eslint-disable-next-line require-jsdoc
async function deleteBucket(bucket) {
  const response = await aws.s3().listObjects({ Bucket: bucket }).promise();
  const keys = response.Contents.map((o) => o.Key);
  await Promise.all(keys.map(
    (key) => aws.s3().deleteObject({ Bucket: bucket, Key: key }).promise()
  ));
}

test.beforeEach((t) => {
  t.context.bucket = 'cumulus-public'; // eslint-disable-line no-param-reassign
  return aws.s3().createBucket({ Bucket: t.context.bucket }).promise();
});

test.afterEach.always(async (t) => {
  deleteBucket(t.context.bucket);
});

test('should succeed if cmr correctly identifies the xml as invalid', (t) => {
  sinon.stub(cmrjs.CMR.prototype, 'getToken');

  const newPayload = JSON.parse(JSON.stringify(payload));
  const granuleId = Object.keys(newPayload.input.allGranules)[0];
  const key = `${granuleId}.cmr.xml`;

  return aws.promiseS3Upload({
    Bucket: t.context.bucket,
    Key: key,
    Body: '<?xml version="1.0" encoding="UTF-8"?><results></results>'
  }).then(() => {
    return postToCMR(newPayload)
      .then(() => {
        cmrjs.CMR.prototype.getToken.restore();
        t.fail();
      })
      .catch((e) => {
        cmrjs.CMR.prototype.getToken.restore();
        t.true(e instanceof cmrjs.ValidationError);
      });
  });
});

test('should succeed with correct payload', (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  sinon.stub(cmrjs.CMR.prototype, 'ingestGranule').callsFake(() => ({
    result
  }));
  const granuleId = Object.keys(newPayload.input.allGranules)[0];
  const key = `${granuleId}.cmr.xml`;

  return aws.promiseS3Upload({
    Bucket: t.context.bucket,
    Key: key,
    Body: fs.createReadStream('tests/data/meta.xml')
  }).then(() => {
    return postToCMR(newPayload)
      .then((output) => {
        cmrjs.CMR.prototype.ingestGranule.restore();
        t.is(
          output.granules[0].cmrLink,
          `https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=${result['concept-id']}`
        );
      })
      .catch((e) => {
        console.log(e);
        cmrjs.CMR.prototype.ingestGranule.restore();
        t.fail();
      });
  });
});

test('Should skip cmr step if the metadata file uri is missing', (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  newPayload.input.allGranules = [{
    granuleId: 'some granule',
    files: [{
      filename: `s3://${t.context.bucket}/to/file.xml`
    }]
  }];
  newPayload.input.inputFiles = [];

  return postToCMR(newPayload)
    .then((output) => {
      t.is(output.granules[0].cmr, undefined);
    })
    .catch(t.fail);
});
