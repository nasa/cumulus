'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const sinon = require('sinon');
const { S3 } = require('@cumulus/aws-client');
const { metadataObjectFromCMRFile } = require('@cumulus/cmrjs/cmr-utils');
const log = require('@cumulus/common/log');
const { randomString } = require('@cumulus/common/test-utils');
const { updateCmrAccessConstraints, validateConfig } = require('..');

test.before(async (t) => {
  t.context.bucket = randomString();
  await S3.createBucket(t.context.bucket);
});

test.after.always(async (t) => {
  await S3.recursivelyDeleteS3Bucket(t.context.bucket);
});

test('updateCmrAccessConstraints updates Echo10XML CMR metadata with access constraint', async (t) => {
  const key = `${randomString()}.cmr.xml`;
  const { ETag } = await S3.s3PutObject({
    Bucket: t.context.bucket,
    Key: key,
    Body: fs.readFileSync(
      path.join(__dirname, 'fixtures/MOD09GQ.A2016358.h13v04.006.2016360104606.cmr.xml')
    ),
  });
  const payload = {
    granules: [{
      granuleId: 'abcd1234',
      files: [{
        bucket: t.context.bucket,
        key: key,
        etag: ETag,
      }],
    }],
  };
  const accessConstraints = {
    value: 17,
    description: 'Test AccessConstraint Value',
  };
  const handlerResponse = await updateCmrAccessConstraints({
    input: payload,
    config: {
      accessConstraints,
    },
  });
  // ensure updated ETag
  const newETag = handlerResponse.granules[0].files[0].etag;
  t.not(newETag, ETag);
  // ensure AccessConstraint is set in the metadata
  const updatedMetadata = await metadataObjectFromCMRFile(
    S3.buildS3Uri(t.context.bucket, key),
    newETag
  );
  t.is(updatedMetadata.Granule.RestrictionFlag, accessConstraints.value.toString());
  t.is(updatedMetadata.Granule.RestrictionComment, accessConstraints.description);
});

test('updateCmrAccessConstraints updates UMMG-JSON CMR metadata with access constraint', async (t) => {
  const key = `${randomString()}.cmr.json`;
  const { ETag } = await S3.s3PutObject({
    Bucket: t.context.bucket,
    Key: key,
    Body: fs.readFileSync(
      path.join(__dirname, 'fixtures/MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json')
    ),
  });
  const payload = {
    granules: [{
      granuleId: 'abcd1234',
      files: [{
        bucket: t.context.bucket,
        key: key,
        etag: ETag,
      }],
    }],
  };
  const accessConstraints = {
    value: 17,
    description: 'Test AccessConstraint Value',
  };
  const handlerResponse = await updateCmrAccessConstraints({
    input: payload,
    config: {
      accessConstraints,
    },
  });
  // ensure updated ETag
  const newETag = handlerResponse.granules[0].files[0].etag;
  t.not(newETag, ETag);
  // ensure AccessConstraint is set in the metadata
  const updatedMetadata = await metadataObjectFromCMRFile(
    S3.buildS3Uri(t.context.bucket, key),
    newETag
  );
  t.is(updatedMetadata.AccessConstraints.Value, accessConstraints.value);
  t.is(updatedMetadata.AccessConstraints.Description, accessConstraints.description);
});

test('validateConfig silently passes valid config', (t) => {
  t.notThrows(() => validateConfig({
    accessConstraints: {
      value: 5,
      description: 'basic access constraint',
    },
  }));
});

test('validateConfig throws error when no accessConstraintValue is provided', (t) => {
  t.throws(
    () => validateConfig({ accessConstraints: {} }),
    {
      instanceOf: Error,
      message: 'AccessConstraint value must be an integer, but received: undefined, type undefined',
    }
  );
});

test('validateConfig throws error when accessConstraint value is not an integer', (t) => {
  t.throws(
    () => validateConfig({ accessConstraints: { value: 5.5 } }),
    {
      instanceOf: Error,
      message: 'AccessConstraint value must be an integer, but received: 5.5, type number',
    }
  );
  t.throws(
    () => validateConfig({ accessConstraints: { value: '5' } }),
    {
      instanceOf: Error,
      message: 'AccessConstraint value must be an integer, but received: 5, type string',
    }
  );
});

test('validateConfig logs warning if description is undefined', (t) => {
  try {
    const logSpy = sinon.spy(log, 'warn');
    validateConfig({ accessConstraints: { value: 5 } });
    t.true(logSpy.calledOnce);
  } finally {
    sinon.restore();
  }
});

test('validateConfig logs error if description is not a string', (t) => {
  try {
    const logSpy = sinon.spy(log, 'error');
    validateConfig({ accessConstraints: { value: 5, description: 1234 } });
    t.true(logSpy.calledOnce);
  } finally {
    sinon.restore();
  }
});
