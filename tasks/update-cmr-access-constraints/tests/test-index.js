'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const { S3 } = require('@cumulus/aws-client');
const { metadataObjectFromCMRFile } = require('@cumulus/cmrjs/cmr-utils');
const { randomString, validateInput, validateConfig, validateOutput } = require('@cumulus/common/test-utils');
const { updateCmrAccessConstraints } = require('..');

test.before(async (t) => {
  t.context.bucket = randomString();
  await S3.createBucket(t.context.bucket);
});

test.after.always(async (t) => {
  await S3.recursivelyDeleteS3Bucket(t.context.bucket);
});

test('updateCmrAccessConstraints updates etag for CMR file and leaves other etags intact', async (t) => {
  const key = `${randomString()}.cmr.xml`;
  const { ETag } = await S3.s3PutObject({
    Bucket: t.context.bucket,
    Key: key,
    Body: fs.readFileSync(
      path.join(__dirname, 'fixtures/MOD09GQ.A2016358.h13v04.006.2016360104606.cmr.xml')
    ),
  });
  const cmrFileS3Uri = S3.buildS3Uri(t.context.bucket, key);

  const dataFileKey = `${randomString()}.hdf`;
  const dataFileS3Uri = S3.buildS3Uri(t.context.bucket, dataFileKey);
  const dataFileOriginalETag = '"foo"';

  const payloadInput = {
    granules: [{
      granuleId: 'abcd1234',
      files: [{
        bucket: t.context.bucket,
        key,
      }, {
        bucket: t.context.bucket,
        key: dataFileKey,
      }],
    }],
  };
  await validateInput(t, payloadInput);
  const payloadConfig = {
    accessConstraints: {
      value: 17,
      description: 'Test AccessConstraint Value',
    },
    etags: {
      [cmrFileS3Uri]: ETag,
      [dataFileS3Uri]: dataFileOriginalETag,
    },
  };
  await validateConfig(t, payloadConfig);
  const handlerResponse = await updateCmrAccessConstraints({
    input: payloadInput,
    config: payloadConfig,
  });
  await validateOutput(t, handlerResponse);
  // ensure updated ETag for CMR file
  const updatedCmrETag = handlerResponse.etags[cmrFileS3Uri];
  t.false([ETag, undefined].includes(updatedCmrETag));
  // ensure other etag is unchanged
  t.is(handlerResponse.etags[dataFileS3Uri], dataFileOriginalETag);
});

// ECHO10 XML tests
test('updateCmrAccessConstraints updates Echo10XML CMR metadata with access constraint', async (t) => {
  const key = `${randomString()}.cmr.xml`;
  const { ETag } = await S3.s3PutObject({
    Bucket: t.context.bucket,
    Key: key,
    Body: fs.readFileSync(
      path.join(__dirname, 'fixtures/MOD09GQ.A2016358.h13v04.006.2016360104606.cmr.xml')
    ),
  });
  const s3Uri = S3.buildS3Uri(t.context.bucket, key);
  const payloadInput = {
    granules: [{
      granuleId: 'abcd1234',
      files: [{
        bucket: t.context.bucket,
        key: key,
      }],
    }],
  };
  await validateInput(t, payloadInput);
  const payloadConfig = {
    accessConstraints: {
      value: 17,
      description: 'Test AccessConstraint Value',
    },
    etags: {
      s3Uri: ETag,
    },
  };
  await validateConfig(t, payloadConfig);
  const handlerResponse = await updateCmrAccessConstraints({
    input: payloadInput,
    config: payloadConfig,
  });
  await validateOutput(t, handlerResponse);
  // ensure updated ETag
  const newETag = handlerResponse.etags[s3Uri];
  t.false([ETag, undefined].includes(newETag));
  // ensure AccessConstraint is set in the metadata
  const updatedMetadata = await metadataObjectFromCMRFile(
    S3.buildS3Uri(t.context.bucket, key),
    newETag
  );
  t.is(updatedMetadata.Granule.RestrictionFlag, payloadConfig.accessConstraints.value.toString());
  t.is(updatedMetadata.Granule.RestrictionComment, payloadConfig.accessConstraints.description);
});

test('updateCmrAccessConstraints updates Echo10XML CMR metadata with access constraint when there is no etags config', async (t) => {
  const key = `${randomString()}.cmr.xml`;
  const { ETag } = await S3.s3PutObject({
    Bucket: t.context.bucket,
    Key: key,
    Body: fs.readFileSync(
      path.join(__dirname, 'fixtures/MOD09GQ.A2016358.h13v04.006.2016360104606.cmr.xml')
    ),
  });
  const s3Uri = S3.buildS3Uri(t.context.bucket, key);
  const payloadInput = {
    granules: [{
      granuleId: 'abcd1234',
      files: [{
        bucket: t.context.bucket,
        key: key,
      }],
    }],
  };
  await validateInput(t, payloadInput);
  const payloadConfig = {
    accessConstraints: {
      value: 17,
      description: 'Test AccessConstraint Value',
    },
  };
  await validateConfig(t, payloadConfig);
  delete payloadConfig.etags;
  const handlerResponse = await updateCmrAccessConstraints({
    input: payloadInput,
    config: payloadConfig,
  });
  await validateOutput(t, handlerResponse);
  // ensure updated ETag
  const newETag = handlerResponse.etags[s3Uri];
  t.false([ETag, undefined].includes(newETag));
  // ensure AccessConstraint is set in the metadata
  const updatedMetadata = await metadataObjectFromCMRFile(
    S3.buildS3Uri(t.context.bucket, key),
    newETag
  );
  t.is(updatedMetadata.Granule.RestrictionFlag, payloadConfig.accessConstraints.value.toString());
  t.is(updatedMetadata.Granule.RestrictionComment, payloadConfig.accessConstraints.description);
});

test('updateCmrAccessConstraints sets Echo10XML RestrictionComment to "None" if undefined', async (t) => {
  const key = `${randomString()}.cmr.xml`;
  const { ETag } = await S3.s3PutObject({
    Bucket: t.context.bucket,
    Key: key,
    Body: fs.readFileSync(
      path.join(__dirname, 'fixtures/MOD09GQ.A2016358.h13v04.006.2016360104606.cmr.xml')
    ),
  });
  const s3Uri = S3.buildS3Uri(t.context.bucket, key);
  const payloadInput = {
    granules: [{
      granuleId: 'abcd1234',
      files: [{
        bucket: t.context.bucket,
        key: key,
      }],
    }],
  };
  await validateInput(t, payloadInput);
  const payloadConfig = {
    accessConstraints: {
      value: 17,
    },
    etags: {
      s3Uri: ETag,
    },
  };
  await validateConfig(t, payloadConfig);
  const handlerResponse = await updateCmrAccessConstraints({
    input: payloadInput,
    config: payloadConfig,
  });
  await validateOutput(t, handlerResponse);
  // ensure updated ETag
  const newETag = handlerResponse.etags[s3Uri];
  t.false([ETag, undefined].includes(newETag));
  // ensure AccessConstraint is set in the metadata
  const updatedMetadata = await metadataObjectFromCMRFile(
    S3.buildS3Uri(t.context.bucket, key),
    newETag
  );
  t.is(updatedMetadata.Granule.RestrictionFlag, payloadConfig.accessConstraints.value.toString());
  t.is(updatedMetadata.Granule.RestrictionComment, 'None');
});

// UMM-G JSON tests
test('updateCmrAccessConstraints updates UMMG-JSON CMR metadata with access constraint', async (t) => {
  const key = `${randomString()}.cmr.json`;
  const { ETag } = await S3.s3PutObject({
    Bucket: t.context.bucket,
    Key: key,
    Body: fs.readFileSync(
      path.join(__dirname, 'fixtures/MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json')
    ),
  });
  const s3Uri = S3.buildS3Uri(t.context.bucket, key);
  const payloadInput = {
    granules: [{
      granuleId: 'abcd1234',
      files: [{
        bucket: t.context.bucket,
        key: key,
      }],
    }],
  };
  await validateInput(t, payloadInput);
  const payloadConfig = {
    accessConstraints: {
      value: 17,
      description: 'Test AccessConstraint Value',
    },
    etags: {
      s3Uri: ETag,
    },
  };
  await validateConfig(t, payloadConfig);
  const handlerResponse = await updateCmrAccessConstraints({
    input: payloadInput,
    config: payloadConfig,
  });
  await validateOutput(t, handlerResponse);
  // ensure updated ETag
  const newETag = handlerResponse.etags[s3Uri];
  t.false([ETag, undefined].includes(newETag));
  // ensure AccessConstraint is set in the metadata
  const updatedMetadata = await metadataObjectFromCMRFile(
    S3.buildS3Uri(t.context.bucket, key),
    newETag
  );
  t.is(updatedMetadata.AccessConstraints.Value, payloadConfig.accessConstraints.value);
  t.is(updatedMetadata.AccessConstraints.Description, payloadConfig.accessConstraints.description);
});

test('updateCmrAccessConstraints sets UMM-G JSON AccessConstraint Description to "None" if undefined', async (t) => {
  const key = `${randomString()}.cmr.json`;
  const { ETag } = await S3.s3PutObject({
    Bucket: t.context.bucket,
    Key: key,
    Body: fs.readFileSync(
      path.join(__dirname, 'fixtures/MOD09GQ.A3411593.1itJ_e.006.9747594822314.cmr.json')
    ),
  });
  const s3Uri = S3.buildS3Uri(t.context.bucket, key);
  const payloadInput = {
    granules: [{
      granuleId: 'abcd1234',
      files: [{
        bucket: t.context.bucket,
        key: key,
      }],
    }],
  };
  await validateInput(t, payloadInput);
  const payloadConfig = {
    accessConstraints: {
      value: 17,
    },
    etags: {
      s3Uri: ETag,
    },
  };
  await validateConfig(t, payloadConfig);
  const handlerResponse = await updateCmrAccessConstraints({
    input: payloadInput,
    config: payloadConfig,
  });
  await validateOutput(t, handlerResponse);
  // ensure updated ETag
  const newETag = handlerResponse.etags[s3Uri];
  t.false([ETag, undefined].includes(newETag));
  // ensure AccessConstraint is set in the metadata
  const updatedMetadata = await metadataObjectFromCMRFile(
    S3.buildS3Uri(t.context.bucket, key),
    newETag
  );
  t.is(updatedMetadata.AccessConstraints.Value, payloadConfig.accessConstraints.value);
  t.is(updatedMetadata.AccessConstraints.Description, 'None');
});
