'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const cloneDeep = require('lodash/cloneDeep');

const {
  buildS3Uri,
  getObject,
  getObjectStreamContents,
  recursivelyDeleteS3Bucket,
  putJsonS3Object,
  promiseS3Upload,
  parseS3Uri,
} = require('@cumulus/aws-client/S3');
const {
  randomId, randomString, validateConfig, validateInput,
} = require('@cumulus/common/test-utils');
const { s3 } = require('@cumulus/aws-client/services');
const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');

const { isCMRFile } = require('@cumulus/cmrjs');

const { updateGranulesCmrMetadata } = require('..');

function cmrReadStream(file) {
  return file.endsWith('.cmr.xml') ? fs.createReadStream('tests/data/meta-exclude-data-granule.xml') :
    fs.createReadStream('tests/data/ummg-meta-exclude-data-granule.json');
}

async function uploadFiles(files, bucket) {
  await Promise.all(files.map((file) => promiseS3Upload({
    params: {
      Bucket: bucket,
      Key: parseS3Uri(file).Key,
      Body: !(file.endsWith('.cmr.xml') || file.endsWith('.cmr.json'))
        ? parseS3Uri(file).Key : cmrReadStream(file),
    },
  })));
}

function granulesToFileURIs(stagingBucket, granules) {
  const files = granules.reduce((arr, g) => arr.concat(g.files), []);
  return files.map((file) => buildS3Uri(stagingBucket, file.key));
}

function buildPayload(t) {
  const newPayload = t.context.payload;

  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal.name = t.context.stagingBucket;
  newPayload.config.buckets.public.name = t.context.publicBucket;
  newPayload.config.buckets.protected.name = t.context.protectedBucket;

  const updatedETagConfigObject = {};
  Object.keys(newPayload.config.etags).forEach((k) => {
    const ETag = newPayload.config.etags[k];
    const newURI = buildS3Uri(
      t.context.stagingBucket,
      parseS3Uri(k).Key
    );
    updatedETagConfigObject[newURI] = ETag;
  });
  newPayload.config.etags = updatedETagConfigObject;

  newPayload.input.granules.forEach((gran) => {
    gran.files.forEach((file) => {
      file.bucket = t.context.stagingBucket;
    });
  });

  return newPayload;
}

test.beforeEach(async (t) => {
  t.context.stagingBucket = randomId('staging');
  t.context.publicBucket = randomId('public');
  t.context.protectedBucket = randomId('protected');
  t.context.systemBucket = randomId('system');
  t.context.stackName = randomString();
  await Promise.all([
    s3().createBucket({ Bucket: t.context.stagingBucket }),
    s3().createBucket({ Bucket: t.context.publicBucket }),
    s3().createBucket({ Bucket: t.context.protectedBucket }),
    s3().createBucket({ Bucket: t.context.systemBucket }),
  ]);
  process.env.system_bucket = t.context.systemBucket;
  process.env.stackName = t.context.stackName;
  putJsonS3Object(
    t.context.systemBucket,
    getDistributionBucketMapKey(t.context.stackName),
    {
      [t.context.stagingBucket]: t.context.stagingBucket,
      [t.context.publicBucket]: t.context.publicBucket,
      [t.context.protectedBucket]: t.context.protectedBucket,
      [t.context.systemBucket]: t.context.systemBucket,
    }
  );

  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(
    t.context.stagingBucket,
    t.context.payload.input.granules
  );
  t.context.filesToUpload = filesToUpload;
  process.env.REINGEST_GRANULE = false;
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.publicBucket);
  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  await recursivelyDeleteS3Bucket(t.context.protectedBucket);
  await recursivelyDeleteS3Bucket(t.context.systemBucket);
});

test.serial('update-granules-cmr-metadata-file-links does not add granule.DataGranule if task config var excludeDataGranule is true', async (t) => {
  const newPayload = buildPayload(t);

  newPayload.input.granules.forEach((granule) => {
    const newFile = {
      bucket: t.context.publicBucket,
      key: 'some/prefix/some_filename.json',
      type: 'data',
    };
    granule.files.push(newFile);
  });
  newPayload.config.excludeDataGranule = true;

  await validateConfig(t, newPayload.config);
  await validateInput(t, newPayload.input);

  const filesToUpload = cloneDeep(t.context.filesToUpload);
  await uploadFiles(filesToUpload, t.context.stagingBucket);
  await updateGranulesCmrMetadata(newPayload);

  const cmrFiles = [];
  newPayload.input.granules.forEach((granule) => {
    granule.files.forEach((file) => {
      if (isCMRFile(file)) {
        cmrFiles.push(file);
      }
    });
  });

  await Promise.all(cmrFiles.map(async (cmrFile) => {
    const payloadResponse = await getObject(s3(), { Bucket: cmrFile.bucket, Key: cmrFile.key });
    const payloadContents = await getObjectStreamContents(payloadResponse.Body);
    t.false(payloadContents.includes('DataGranule'));
  }));
});

test.serial('update-granules-cmr-metadata-file-links adds a granule.DataGranule if task config var excludeDataGranule is false', async (t) => {
  const newPayload = buildPayload(t);

  newPayload.input.granules.forEach((granule) => {
    const newFile = {
      bucket: t.context.publicBucket,
      key: 'some/prefix/some_filename.json',
      type: 'data',
    };
    granule.files.push(newFile);
  });
  newPayload.config.excludeDataGranule = false;

  await validateConfig(t, newPayload.config);
  await validateInput(t, newPayload.input);

  const filesToUpload = cloneDeep(t.context.filesToUpload);
  await uploadFiles(filesToUpload, t.context.stagingBucket);
  await updateGranulesCmrMetadata(newPayload);

  const cmrFiles = [];
  newPayload.input.granules.forEach((granule) => {
    granule.files.forEach((file) => {
      if (isCMRFile(file)) {
        cmrFiles.push(file);
      }
    });
  });

  await Promise.all(cmrFiles.map(async (cmrFile) => {
    const payloadResponse = await getObject(s3(), { Bucket: cmrFile.bucket, Key: cmrFile.key });
    const payloadContents = await getObjectStreamContents(payloadResponse.Body);
    t.true(payloadContents.includes('DataGranule'));
  }));
});

test.serial('update-granules-cmr-metadata-file-links adds a granule.DataGranule and populates defalts for UMMG granules if task config var excludeDataGranule is false', async (t) => {
  const newPayload = buildPayload(t);

  // exclude the ECHO10 granule for this test
  newPayload.input.granules.shift();

  newPayload.input.granules.forEach((granule) => {
    const newFile = {
      bucket: t.context.publicBucket,
      key: 'some/prefix/some_filename.json',
      type: 'data',
    };
    granule.files.push(newFile);
  });
  newPayload.config.excludeDataGranule = false;

  await validateConfig(t, newPayload.config);
  await validateInput(t, newPayload.input);

  const filesToUpload = cloneDeep(t.context.filesToUpload);
  await uploadFiles(filesToUpload, t.context.stagingBucket);
  await updateGranulesCmrMetadata(newPayload);

  const cmrFiles = [];
  newPayload.input.granules.forEach((granule) => {
    granule.files.forEach((file) => {
      if (isCMRFile(file)) {
        cmrFiles.push(file);
      }
    });
  });

  await Promise.all(cmrFiles.map(async (cmrFile) => {
    const payloadResponse = await getObject(s3(), { Bucket: cmrFile.bucket, Key: cmrFile.key });
    const payloadContents = await getObjectStreamContents(payloadResponse.Body);
    t.true(payloadContents.includes('DataGranule'));
    // required UMMG DataGranule fields
    t.true(payloadContents.includes('DayNightFlag') && payloadContents.includes('ProductionDateTime'));
  }));
});

test.serial('update-granules-cmr-metadata-file-links adds a granule.DataGranule and populates required field for ECHO10 granule if task config var excludeDataGranule is false', async (t) => {
  const newPayload = buildPayload(t);
  const producerGranuleId = newPayload.input.granules[0].granuleId;

  // exclude the UMMG granules for this test
  newPayload.input.granules.splice(1);

  newPayload.input.granules[0].files.push({
    bucket: t.context.publicBucket,
    key: 'some/prefix/some_filename.json',
    type: 'data',
  });

  newPayload.config.excludeDataGranule = false;

  await validateConfig(t, newPayload.config);
  await validateInput(t, newPayload.input);

  const filesToUpload = cloneDeep(t.context.filesToUpload);
  await uploadFiles(filesToUpload, t.context.stagingBucket);
  await updateGranulesCmrMetadata(newPayload);

  const cmrFiles = [];
  newPayload.input.granules[0].files.forEach((file) => {
    if (isCMRFile(file)) {
      cmrFiles.push(file);
    }
  });

  await Promise.all(cmrFiles.map(async (cmrFile) => {
    const payloadResponse = await getObject(s3(), { Bucket: cmrFile.bucket, Key: cmrFile.key });
    const payloadContents = await getObjectStreamContents(payloadResponse.Body);
    t.true(payloadContents.includes('<DataGranule>') && payloadContents.includes('</DataGranule>'));
    // required ECHO10 DataGranule field
    t.true(payloadContents.includes(`<ProducerGranuleId>${producerGranuleId}</ProducerGranuleId>`));
  }));
});
