'use strict';

import fs from 'fs';
import test from 'ava';
import sinon from 'sinon';
import aws from '@cumulus/common/aws';
import testUtils from '@cumulus/common/test-utils';

import cmrjs from '@cumulus/cmrjs';
import payload from './data/payload.json';
import { handler } from '../index';

const result = {
  'concept-id': 'testingtesging'
};

async function deleteBucket(bucket) {
  const response = await aws.s3().listObjects({ Bucket: bucket }).promise();
  const keys = response.Contents.map((o) => o.Key);
  await Promise.all(keys.map((key) =>
    aws.s3().deleteObject({ Bucket: bucket, Key: key }).promise()
  ));
}

test.beforeEach((t) => {
  t.context.bucket = testUtils.randomString();
  return aws.s3().createBucket({ Bucket: t.context.bucket }).promise();
});

test.afterEach.always(async (t) => {
  deleteBucket(t.context.bucket);
});

test.cb.serial('should succeed if cmr correctly identifies the xml as invalid', (t) => {
  sinon.stub(cmrjs.CMR.prototype, 'getToken');

  aws.promiseS3Upload({
    Bucket: t.context.bucket,
    Key: 'meta.cmr.xml',
    Body: '<?xml version="1.0" encoding="UTF-8"?><results></results>'
  }).then(() => {
    const newPayload = JSON.parse(JSON.stringify(payload));
    newPayload.input.granules[0].files.push({ filename: `s3://${t.context.bucket}/meta.cmr.xml` });
    handler(newPayload, {}, (e) => {
      cmrjs.CMR.prototype.getToken.restore();
      t.true(e instanceof cmrjs.ValidationError);
      t.end();
    });
  });
});

test.cb.serial('should succeed with correct payload', (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  sinon.stub(cmrjs.CMR.prototype, 'ingestGranule').callsFake(() => ({
    result
  }));

  aws.promiseS3Upload({
    Bucket: t.context.bucket,
    Key: 'meta.cmr.xml',
    Body: fs.createReadStream('tests/data/meta.xml')
  }).then(() => {
    newPayload.input.granules[0].files.push({ filename: `s3://${t.context.bucket}/meta.cmr.xml` });
    handler(newPayload, {}, (e, output) => {
      cmrjs.CMR.prototype.ingestGranule.restore();
      t.is(e, null);
      t.is(
        output.granules[0].cmr.link,
        `https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=${result['concept-id']}`
      );
      t.end(e);
    });
  });
});

test.cb.serial('Should skip cmr step if the metadata file uri is missing', (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  newPayload.input.granules = [{
    granuleId: 'some granule',
    files: [{
      filename: `s3://${t.context.bucket}/to/file.xml`
    }]
  }];

  handler(newPayload, {}, (e, output) => {
    t.is(output.granules[0].cmr, undefined);
    t.end();
  });
});

// test.after(() => {
//   S3.get.restore();
// });
