'use strict';

const sinon = require('sinon');
const path = require('path');
const test = require('ava');
const range = require('lodash/range');
const { sleep } = require('@cumulus/common');
const { s3 } = require('@cumulus/aws-client/services');
const {
  calculateObjectHash,
  listS3ObjectsV2,
  recursivelyDeleteS3Bucket,
  s3ObjectExists,
  s3Join,
  promiseS3Upload,
  headObject,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const errors = require('@cumulus/errors');
const set = require('lodash/set');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { loadJSONTestData, streamTestData } = require('@cumulus/test-data');

const {
  randomString,
  validateConfig,
  validateInput,
  validateOutput,
} = require('@cumulus/common/test-utils');
const {
  syncGranule,
} = require('..');

// prepare the s3 event and data
async function prepareS3DownloadEvent(t) {
  const granuleFilePath = randomString();

  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: randomString(),
  };

  t.context.event.input.granules[0].files[0].path = granuleFilePath;
  t.context.event.config.fileStagingDir = randomString();

  await s3().createBucket({ Bucket: t.context.event.config.provider.host });

  // Stage the file that's going to be downloaded
  for (let i = 0; i < t.context.event.input.granules.length; i += 1) {
    for (let j = 0; j < t.context.event.input.granules[i].files.length; j += 1) {
      t.context.event.input.granules[i].files[j].path = granuleFilePath;
      const granuleFileName = t.context.event.input.granules[i].files[j].name;
      const key = `${granuleFilePath}/${granuleFileName}`;

      // eslint-disable-next-line no-await-in-loop
      await s3PutObject({
        Bucket: t.context.event.config.provider.host,
        Key: key,
        Body: streamTestData(`granules/${granuleFileName}`),
      });
    }
  }
}

/**
 * Get file metadata for a set of files.
 * headObject from localstack doesn't return LastModified with millisecond,
 * use listObjectsV2 instead
 *
 * @param {Array<Object>} files - array of file objects
 * @returns {Promise<Array>} - file detail responses
 */
async function getFilesMetadata(files) {
  const getFileRequests = files.map(async (f) => {
    const s3list = await listS3ObjectsV2(
      { Bucket: f.bucket, Prefix: f.key }
    );
    const s3object = s3list.filter((s3file) => s3file.Key === f.key);

    return {
      filename: f.filename,
      size: s3object[0].Size,
      LastModified: s3object[0].LastModified,
    };
  });
  return await Promise.all(getFileRequests);
}

// Setup buckets and the test event
test.beforeEach(async (t) => {
  t.context.internalBucketName = randomString();
  t.context.protectedBucketName = randomString();
  t.context.privateBucketName = randomString();

  await Promise.all([
    s3().createBucket({ Bucket: t.context.internalBucketName }),
    s3().createBucket({ Bucket: t.context.privateBucketName }),
    s3().createBucket({ Bucket: t.context.protectedBucketName }),
  ]);

  t.context.event = await loadJSONTestData('payloads/new-message-schema/ingest.json');
  t.context.event_multigran = await loadJSONTestData('payloads/new-message-schema/ingest-multigran.json');

  const collection = t.context.event.config.collection;
  // save collection in internal/stackName/collections/collectionId
  const key = `${process.env.stackName}/collections/${collection.name}___${Number.parseInt(collection.version, 10)}.json`;
  await promiseS3Upload({
    params: {
      Bucket: t.context.internalBucketName,
      Key: key,
      Body: JSON.stringify(collection),
      ACL: 'public-read',
    },
  });

  t.context.event.config.downloadBucket = t.context.internalBucketName;
  t.context.event.config.buckets.internal = {
    name: t.context.internalBucketName,
    type: 'internal',
  };
  t.context.event.config.buckets.private = {
    name: t.context.privateBucketName,
    type: 'private',
  };
  t.context.event.config.buckets.protected = {
    name: t.context.protectedBucketName,
    type: 'protected',
  };
});

// Clean up
test.afterEach.always((t) => Promise.all([
  recursivelyDeleteS3Bucket(t.context.internalBucketName),
  recursivelyDeleteS3Bucket(t.context.privateBucketName),
  recursivelyDeleteS3Bucket(t.context.protectedBucketName),
]));

test.serial('should return empty granules list given empty granules list on input', async (t) => {
  t.context.event.input.granules = [];

  const output = await syncGranule(t.context.event);

  t.deepEqual(output.granules, [], 'output granules list should be empty');
});

test.serial('should return empty granules list given no granules list on input', async (t) => {
  delete t.context.event.input.granules;

  const output = await syncGranule(t.context.event);

  t.deepEqual(output.granules, [], 'output granules list should be empty');
});

test.serial('error when provider info is missing', async (t) => {
  delete t.context.event.config.provider;

  try {
    await syncGranule(t.context.event);
    t.fail();
  } catch (error) {
    t.true(error instanceof errors.ProviderNotFound);
  }
});

test.serial('no error when collection info is not provided in the event', async (t) => {
  delete t.context.event.config.collection;
  // if not passed in the collection, this is required to be passed in context
  t.context.event.config.duplicateHandling = 'replace';
  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
  };

  const output = await syncGranule(t.context.event);
  await validateOutput(t, output);
  t.is(output.granules.length, 1);
  t.is(output.granules[0].files.length, 1);
});

test.serial('download Granule from FTP endpoint', async (t) => {
  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
  };

  t.context.event.config.collection.url_path = 'example/';
  await validateConfig(t, t.context.event.config);
  await validateInput(t, t.context.event.input);

  const output = await syncGranule(t.context.event);

  await validateOutput(t, output);

  t.is(output.granules.length, 1);
  t.is(output.granules[0].files.length, 1);
  const config = t.context.event.config;
  const key = `file-staging/${config.stack}/${config.collection.name}___${Number.parseInt(config.collection.version, 10)}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`;

  const expected = {
    bucket: t.context.internalBucketName,
    key,
    size: 1098034,
    source: '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
    fileName: 'MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
    checksum: '1435712144',
    checksumType: 'CKSUM',
    type: 'data',
  };
  t.deepEqual(output.granules[0].files[0], expected);
});

test.serial('download Granule from HTTP endpoint', async (t) => {
  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
  };
  t.context.event.input.granules[0].files[0].path = '/granules';

  await validateConfig(t, t.context.event.config);
  await validateInput(t, t.context.event.input);

  const output = await syncGranule(t.context.event);

  await validateOutput(t, output);

  t.is(output.granules.length, 1);
  t.is(output.granules[0].files.length, 1);
  const config = t.context.event.config;
  const key = `file-staging/${config.stack}/${config.collection.name}___${Number.parseInt(config.collection.version, 10)}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`;

  const expected = {
    bucket: t.context.internalBucketName,
    key,
    size: 1098034,
    source: '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
    fileName: 'MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
    checksum: '1435712144',
    checksumType: 'CKSUM',
    type: 'data',
  };
  t.deepEqual(output.granules[0].files[0], expected);
});

test.serial('verify that all returned granules have sync_granule_duration set', async (t) => {
  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
  };
  t.context.event.input.granules[0].files[0].path = '/granules';

  await validateConfig(t, t.context.event.config);
  await validateInput(t, t.context.event.input);
  let output;

  // this is try try to alleviate a common intermitten failure point in cicd
  for (const i of range(10)) {
    if (i < 9) {
      try {
        // eslint-disable-next-line no-await-in-loop
        output = await syncGranule(t.context.event);
      } catch {
        console.log(`known IMF source 'verify that all returned granules have sync_granule_duration set' returned a bad value for the ${i}th time`);
        sleep(10000);
      }
    } else {
      // eslint-disable-next-line no-await-in-loop
      output = await syncGranule(t.context.event);
    }
  }

  await validateOutput(t, output);

  t.is(output.granules.length, 1);

  output.granules.forEach((g) => {
    t.true(Number.isInteger(g.sync_granule_duration));
    t.true(g.sync_granule_duration >= 0);
  });
});

test.serial('download Granule from SFTP endpoint', async (t) => {
  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'sftp',
    host: '127.0.0.1',
    port: 2222,
    username: 'user',
    password: 'password',
  };

  t.context.event.input.granules[0].files[0].path = '/granules';

  await validateConfig(t, t.context.event.config);
  await validateInput(t, t.context.event.input);

  const output = await syncGranule(t.context.event);

  await validateOutput(t, output);

  t.is(output.granules.length, 1);
  t.is(output.granules[0].files.length, 1);
  const config = t.context.event.config;
  const key = `file-staging/${config.stack}/${config.collection.name}___${Number.parseInt(config.collection.version, 10)}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`;
  const expected = {
    bucket: t.context.internalBucketName,
    key,
    size: 1098034,
    source: '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
    fileName: 'MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
    checksum: '1435712144',
    checksumType: 'CKSUM',
    type: 'data',
  };
  t.deepEqual(output.granules[0].files[0], expected);

  t.is(
    true,
    await s3ObjectExists({
      Bucket: t.context.internalBucketName,
      Key: key,
    })
  );
});

test.serial('download granule from S3 provider with checksum and data file in an alternate bucket', async (t) => {
  const granuleFilePath = randomString();
  const granuleFileName = t.context.event.input.granules[0].files[0].name;
  const alternateDataBucket = randomString();
  const alternateBucket = randomString();
  const checksumFile = granuleFileName.replace('hdf', 'cksum');

  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: randomString(),
  };

  t.context.event.input.granules[0].files[0] = {
    path: granuleFilePath,
    name: granuleFileName,
    type: 'data',
    source_bucket: alternateDataBucket,
  };
  t.context.event.input.granules[0].files[1] = {
    path: granuleFilePath,
    name: checksumFile,
    source_bucket: alternateBucket,
  };
  t.context.event.config.collection.files.push({
    regex: '^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\.cksum$',
    bucket: 'protected',
    sampleFileName: 'MOD09GQ.A2017025.h21v00.006.2017034065104.cksum',
    url_path: 'file-example/',
    checksumFor: '^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\.hdf$',
  });

  await validateConfig(t, t.context.event.config);
  await validateInput(t, t.context.event.input);

  await s3().createBucket({ Bucket: alternateDataBucket });
  await s3().createBucket({ Bucket: alternateBucket });
  t.teardown(async () => {
    await recursivelyDeleteS3Bucket(alternateDataBucket);
    await recursivelyDeleteS3Bucket(alternateBucket);
  });

  // Stage the file that's going to be downloaded
  await s3PutObject({
    Bucket: alternateDataBucket,
    Key: `${granuleFilePath}/${granuleFileName}`,
    Body: streamTestData(`granules/${granuleFileName}`),
  });

  await s3PutObject({
    Bucket: alternateBucket,
    Key: `${granuleFilePath}/${checksumFile}`,
    Body: '1435712144',
  });

  const output = await syncGranule(t.context.event);

  await validateOutput(t, output);

  t.is(output.granules.length, 1);
  t.is(output.granules[0].files.length, 1);
  const config = t.context.event.config;
  const key = `file-staging/${config.stack}/${config.collection.name}___${Number.parseInt(config.collection.version, 10)}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`;
  const expected = {
    bucket: t.context.internalBucketName,
    key,
    size: 1098034,
    source: `${granuleFilePath}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`,
    fileName: 'MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
    checksum: '1435712144',
    checksumType: 'cksum',
    type: 'data',
  };
  t.deepEqual(output.granules[0].files[0], expected);
  t.true(
    await s3ObjectExists({
      Bucket: t.context.internalBucketName,
      Key: key,
    })
  );
});

test.serial('download granule from S3 provider', async (t) => {
  const granuleFilePath = randomString();
  const granuleFileName = t.context.event.input.granules[0].files[0].name;

  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: randomString(),
  };

  t.context.event.input.granules[0].files[0].path = granuleFilePath;

  await validateConfig(t, t.context.event.config);
  await validateInput(t, t.context.event.input);

  await s3().createBucket({ Bucket: t.context.event.config.provider.host });

  try {
    // Stage the file that's going to be downloaded
    await s3PutObject({
      Bucket: t.context.event.config.provider.host,
      Key: `${granuleFilePath}/${granuleFileName}`,
      Body: streamTestData(`granules/${granuleFileName}`),
    });

    const output = await syncGranule(t.context.event);

    await validateOutput(t, output);

    t.is(output.granules.length, 1);
    t.is(output.granules[0].files.length, 1);
    const config = t.context.event.config;
    const key = `file-staging/${config.stack}/${config.collection.name}___${Number.parseInt(config.collection.version, 10)}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`;
    const expected = {
      bucket: t.context.internalBucketName,
      key,
      size: 1098034,
      source: `${granuleFilePath}/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf`,
      fileName: 'MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
      checksum: '1435712144',
      checksumType: 'CKSUM',
      type: 'data',
    };
    t.deepEqual(output.granules[0].files[0], expected);
    t.is(
      true,
      await s3ObjectExists({
        Bucket: t.context.internalBucketName,
        Key: key,
      })
    );
  } finally {
    // Clean up
    recursivelyDeleteS3Bucket(t.context.event.config.provider.host);
  }
});

test.serial('download granule with checksum in file from an HTTP endpoint', async (t) => {
  const event = await loadJSONTestData('payloads/new-message-schema/ingest-checksumfile.json');
  const { config, input } = event;

  config.downloadBucket = t.context.internalBucketName;
  config.buckets.internal.name = t.context.internalBucketName;
  config.buckets.private.name = t.context.privateBucketName;
  config.buckets.protected.name = t.context.protectedBucketName;
  config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
  };

  await validateConfig(t, config);
  await validateInput(t, input);

  const checksumFilename = input.granules[0].files[1].name;
  const output = await syncGranule(event);

  await validateOutput(t, output);

  const key = `file-staging/${config.stack}/${config.collection.name}___${Number.parseInt(config.collection.version, 10)}/20160115-MODIS_T-JPL-L2P-T2016015000000.L2_LAC_GHRSST_N-v01.nc.bz2`;
  const expected = {
    bucket: t.context.internalBucketName,
    key,
    size: 25895363,
    source: '/granules/20160115-MODIS_T-JPL-L2P-T2016015000000.L2_LAC_GHRSST_N-v01.nc.bz2',
    fileName: '20160115-MODIS_T-JPL-L2P-T2016015000000.L2_LAC_GHRSST_N-v01.nc.bz2',
    checksumType: 'md5',
    checksum: 'e627cab0d185ed31394f597d524d762d',
  };
  t.is(output.granules.length, 1);
  t.deepEqual(output.granules[0].files[0], expected);
  t.true(
    await s3ObjectExists({
      Bucket: t.context.internalBucketName,
      Key: key,
    })
  );
  t.false(
    await s3ObjectExists({
      Bucket: t.context.internalBucketName,
      Key: `${path.dirname(key)}/${checksumFilename}`,
    })
  );
});

test.serial('download granule as well as checksum file from an HTTP endpoint', async (t) => {
  const event = await loadJSONTestData('payloads/new-message-schema/ingest-checksumfile.json');
  const { config, input } = event;

  config.syncChecksumFiles = true;
  config.downloadBucket = t.context.internalBucketName;
  config.buckets.internal.name = t.context.internalBucketName;
  config.buckets.private.name = t.context.privateBucketName;
  config.buckets.protected.name = t.context.protectedBucketName;
  config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
  };

  await validateConfig(t, config);
  await validateInput(t, input);

  const output = await syncGranule(event);

  await validateOutput(t, output);

  const granuleFilename = input.granules[0].files[0].name;
  const checksumFilename = input.granules[0].files[1].name;
  const { name, version } = config.collection;
  const collectionId = constructCollectionId(name, version);
  const keypath = `file-staging/${config.stack}/${collectionId}`;
  const granuleFile = output.granules[0].files.find(
    (file) => file.key.endsWith(granuleFilename)
  );
  const checksumFile = output.granules[0].files.find(
    (file) => file.key.endsWith(checksumFilename)
  );

  t.is(output.granules.length, 1);
  t.is(output.granules[0].files.length, 2);
  t.truthy(granuleFile);
  t.truthy(checksumFile);
  t.is(
    `${granuleFile.bucket}/${granuleFile.key}`,
    `${t.context.internalBucketName}/${keypath}/${granuleFilename}`
  );
  t.is(
    `${checksumFile.bucket}/${checksumFile.key}`,
    `${t.context.internalBucketName}/${keypath}/${checksumFilename}`
  );
  t.true(
    await s3ObjectExists({
      Bucket: t.context.internalBucketName,
      Key: `${keypath}/${granuleFilename}`,
    })
  );
  t.true(
    await s3ObjectExists({
      Bucket: t.context.internalBucketName,
      Key: `${keypath}/${checksumFilename}`,
    })
  );
});

test.serial('download granule with bad checksum in file from HTTP endpoint throws', async (t) => {
  const granuleChecksumValue = 8675309;

  // Give it a bogus checksum to prompt a failure in verifyFile
  t.context.event.input.granules[0].files[0].checksum = granuleChecksumValue;
  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
  };

  await validateConfig(t, t.context.event.config);
  await validateInput(t, t.context.event.input);

  // Stage the files to be downloaded
  const granuleFilename = t.context.event.input.granules[0].files[0].name;
  const granuleChecksumType = t.context.event.input.granules[0].files[0].checksumType;
  const config = t.context.event.config;
  const keypath = `file-staging/${config.stack}/${config.collection.name}___${Number.parseInt(config.collection.version, 10)}`;
  const errorMessage = `Invalid checksum for S3 object s3://${t.context.internalBucketName}/${keypath}/${granuleFilename} with type ${granuleChecksumType} and expected sum ${granuleChecksumValue}`;

  await t.throwsAsync(
    () => syncGranule(t.context.event),
    { message: errorMessage }
  );
});

test.serial('validate file properties', async (t) => {
  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
  };
  t.context.event.input.granules[0].files[0].path = '/granules';
  const [file] = t.context.event.input.granules[0].files;

  t.context.event.input.granules[0].files[1] = {
    ...file,
    name: 'MOD09GQ.A2017224.h27v08.006.2017227165029_1.jpg',
  };

  t.context.event.config.collection.files[0].url_path = 'file-example/';
  t.context.event.config.collection.url_path = 'collection-example/';

  await validateConfig(t, t.context.event.config);
  await validateInput(t, t.context.event.input);

  const granuleFilename = t.context.event.input.granules[0].files[0].name;
  const output = await syncGranule(t.context.event);

  await validateOutput(t, output);
  t.is(output.granules.length, 1);
  t.is(output.granules[0].files.length, 2);
  const config = t.context.event.config;
  const keypath = `file-staging/${config.stack}/${config.collection.name}___${Number.parseInt(config.collection.version, 10)}`;
  t.is(
    `${output.granules[0].files[0].bucket}/${output.granules[0].files[0].key}`,
    `${t.context.internalBucketName}/${keypath}/${granuleFilename}`
  );
});

test.serial('when workflow_start_time is provided, then createdAt is set to workflow_start_time', async (t) => {
  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
  };
  const workflowStartTime = 1636334502146;
  t.context.event.config.workflowStartTime = workflowStartTime;

  const output = await syncGranule(t.context.event);

  t.is(output.granules.length, 1);
  output.granules.forEach((g) => {
    t.true(Number.isInteger(g.createdAt));
    t.is(g.createdAt, workflowStartTime);
  });
});

test.serial('when workflow_start_time is NOT provided, then createdAt is set to Date.now()', async (t) => {
  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
  };
  const now = Date.now();

  const nowStub = sinon.stub(Date, 'now').returns(now);
  t.teardown(() => nowStub.restore());

  const output = await syncGranule(t.context.event);

  t.is(output.granules.length, 1);
  output.granules.forEach((g) => {
    t.true(Number.isInteger(g.createdAt));
    t.is(g.createdAt, now);
  });
});

test.serial('when workflow_start_time is a future time then override with Date.now()', async (t) => {
  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
  };
  const now = Date.now();
  // Thu Nov 13 2284 20:55:02 to ensure sufficiently in the future
  const workflowStartTime = 9936334502146;
  t.context.event.config.workflowStartTime = workflowStartTime;

  const nowStub = sinon.stub(Date, 'now').returns(now);
  t.teardown(() => nowStub.restore());

  const output = await syncGranule(t.context.event);

  t.is(output.granules.length, 1);
  output.granules.forEach((g) => {
    t.true(Number.isInteger(g.createdAt));
    t.is(g.createdAt, now);
  });
});

test.serial('attempt to download file from non-existent path - throw error', async (t) => {
  const granuleFilePath = randomString();
  //const granuleFileName = payload.input.granules[0].files[0].name;

  t.context.event.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: randomString(),
  };

  t.context.event.input.granules[0].files[0].path = granuleFilePath;

  await validateConfig(t, t.context.event.config);
  await validateInput(t, t.context.event.input);

  // Create the s3 bucket. If the bucket doesn't exist, we just get a
  // 'bucket doesn't exist' error
  await s3().createBucket({ Bucket: t.context.event.config.provider.host });

  try {
    await t.throwsAsync(
      () => syncGranule(t.context.event),
      undefined,
      'Source file not found'
    );
  } finally {
    // Clean up
    recursivelyDeleteS3Bucket(t.context.event.config.provider.host);
  }
});

async function duplicateHandlingErrorTest(t) {
  await prepareS3DownloadEvent(t);
  const granuleFileName = t.context.event.input.granules[0].files[0].name;

  try {
    const output = await syncGranule(t.context.event);
    await validateOutput(t, output);

    await syncGranule(t.context.event);
    t.fail();
  } catch (error) {
    const collection = t.context.event.config.collection;
    const collectionId = constructCollectionId(collection.name, collection.version);
    const granuleFileKey = s3Join(
      t.context.event.config.fileStagingDir,
      t.context.event.config.stack,
      collectionId,
      granuleFileName
    );
    t.true(error instanceof errors.DuplicateFile);
    t.is(
      error.message,
      `${granuleFileKey} already exists in ${t.context.event.config.downloadBucket} bucket`
    );
  } finally {
    // Clean up
    recursivelyDeleteS3Bucket(t.context.event.config.provider.host);
  }
}

test.serial('when duplicateHandling is not specified, throw an error on duplicate', async (t) => {
  await duplicateHandlingErrorTest(t);
});

test.serial('when duplicateHandling is "error", throw an error on duplicate', async (t) => {
  t.context.event.config.duplicateHandling = 'error';
  await duplicateHandlingErrorTest(t);
});

test.serial('when duplicateHandling is "version", keep both data if different', async (t) => {
  await prepareS3DownloadEvent(t);
  // duplicateHandling is taken from task config or collection config
  t.context.event.config.duplicateHandling = 'version';

  const granuleFileName = t.context.event.input.granules[0].files[0].name;
  const granuleFilePath = t.context.event.input.granules[0].files[0].path;

  const key = `${granuleFilePath}/${granuleFileName}`;

  try {
    // staging the granule
    let output = await syncGranule(t.context.event);

    await validateOutput(t, output);

    const existingFile = output.granules[0].files[0];
    const existingFileInfo = await headObject(
      existingFile.bucket, existingFile.key
    );

    const newContent = randomString();
    // stage the file with different content
    await s3PutObject({
      Bucket: t.context.event.config.provider.host,
      Key: key,
      Body: newContent,
    });

    t.context.event.input.granules[0].files[0].size = newContent.length;
    t.context.event.input.granules[0].files[0].checksum = await calculateObjectHash({
      s3: s3(),
      algorithm: t.context.event.input.granules[0].files[0].checksumType,
      bucket: t.context.event.config.provider.host,
      key,
    });

    output = await syncGranule(t.context.event);
    await validateOutput(t, output);

    t.is(output.granules[0].files.length, 2);

    let filesNotRenamed = output.granules[0].files
      .filter((f) => path.basename(f.key) === granuleFileName);
    t.is(filesNotRenamed.length, 1);

    t.is(
      output.granuleDuplicates[output.granules[0].granuleId].files.length,
      1
    );
    t.is(
      output.granuleDuplicates[output.granules[0].granuleId].files[0].key,
      output.granules[0].files[0].key
    );

    let filesRenamed = output.granules[0].files
      .filter((f) => path.basename(f.key).startsWith(`${granuleFileName}.v`));
    t.is(filesRenamed.length, 1);
    t.false(output.granuleDuplicates[output.granules[0].granuleId].files.includes(filesRenamed[0]));

    const renamedFileInfo = await headObject(filesRenamed[0].bucket, filesRenamed[0].key);
    t.deepEqual(
      renamedFileInfo,
      {
        ...existingFileInfo,
        LastModified: renamedFileInfo.LastModified,
        $metadata: renamedFileInfo.$metadata,
      }
    );

    const newerContent = randomString();
    // stage the file again with different content
    await s3PutObject({
      Bucket: t.context.event.config.provider.host,
      Key: key,
      Body: newerContent,
    });

    t.context.event.input.granules[0].files[0].size = newerContent.length;
    t.context.event.input.granules[0].files[0].checksum = await calculateObjectHash({
      s3: s3(),
      algorithm: t.context.event.input.granules[0].files[0].checksumType,
      bucket: t.context.event.config.provider.host,
      key,
    });

    output = await syncGranule(t.context.event);
    await validateOutput(t, output);

    t.is(output.granules[0].files.length, 3);

    filesNotRenamed = output.granules[0].files
      .filter((f) => path.basename(f.key) === granuleFileName);
    t.is(filesNotRenamed.length, 1);

    filesRenamed = output.granules[0].files
      .filter((f) => path.basename(f.key).startsWith(`${granuleFileName}.v`));
    t.is(filesRenamed.length, 2);
  } finally {
    recursivelyDeleteS3Bucket(t.context.event.config.provider.host);
  }
});

test.serial('when duplicateHandling is "skip", do not overwrite or create new', async (t) => {
  await prepareS3DownloadEvent(t);
  // duplicateHandling is taken from task config or collection config
  t.context.event.config.duplicateHandling = 'skip';

  const granuleFileName = t.context.event.input.granules[0].files[0].name;
  const granuleFilePath = t.context.event.input.granules[0].files[0].path;

  const key = `${granuleFilePath}/${granuleFileName}`;

  try {
    // staging the granule
    let output = await syncGranule(t.context.event);

    await validateOutput(t, output);

    const existingFile = output.granules[0].files[0];
    const existingFileInfo = await headObject(
      existingFile.bucket, existingFile.key
    );

    const newContent = randomString();
    // stage the file with different content
    await s3PutObject({
      Bucket: t.context.event.config.provider.host,
      Key: key,
      Body: newContent,
    });

    t.context.event.input.granules[0].files[0].size = newContent.length;
    t.context.event.input.granules[0].files[0].checksum = await calculateObjectHash({
      s3: s3(),
      algorithm: t.context.event.input.granules[0].files[0].checksumType,
      bucket: t.context.event.config.provider.host,
      key,
    });

    output = await syncGranule(t.context.event);
    await validateOutput(t, output);

    t.is(output.granules[0].files.length, 1);
    t.is(
      output.granuleDuplicates[output.granules[0].granuleId].files.length,
      1
    );
    t.is(
      output.granuleDuplicates[output.granules[0].granuleId].files[0].key,
      output.granules[0].files[0].key
    );

    const currentFile = output.granules[0].files[0];
    const currentFileInfo = await headObject(
      currentFile.bucket, currentFile.key
    );
    t.deepEqual(currentFileInfo, {
      ...existingFileInfo,
      $metadata: currentFileInfo.$metadata,
    });
  } finally {
    recursivelyDeleteS3Bucket(t.context.event.config.provider.host);
  }
});

function setupDuplicateHandlingConfig(t, duplicateHandling, forceDuplicateOverwrite) {
  t.context.event.config.duplicateHandling = duplicateHandling;
  set(t.context.event, 'cumulus_config.cumulus_context.forceDuplicateOverwrite', forceDuplicateOverwrite);
}

function setupDuplicateHandlingCollection(t, duplicateHandling) {
  set(t.context.event, 'config.collection.duplicateHandling', duplicateHandling);
}

async function granuleFilesOverwrittenTest(t) {
  await prepareS3DownloadEvent(t);

  const granuleFileName = t.context.event.input.granules[0].files[0].name;
  const granuleFilePath = t.context.event.input.granules[0].files[0].path;

  const key = `${granuleFilePath}/${granuleFileName}`;

  try {
    // staging the granule
    let output = await syncGranule(t.context.event);

    await validateOutput(t, output);

    const existingFileInfo = (await getFilesMetadata(output.granules[0].files))[0];

    const newContent = randomString();
    // stage the file with different content
    await s3PutObject({
      Bucket: t.context.event.config.provider.host,
      Key: key,
      Body: newContent,
    });

    t.context.event.input.granules[0].files[0].size = newContent.length;
    t.context.event.input.granules[0].files[0].checksum = await calculateObjectHash({
      s3: s3(),
      algorithm: t.context.event.input.granules[0].files[0].checksumType,
      bucket: t.context.event.config.provider.host,
      key,
    });

    output = await syncGranule(t.context.event);
    await validateOutput(t, output);

    t.is(output.granules[0].files.length, 1);
    t.is(
      output.granuleDuplicates[output.granules[0].granuleId].files.length,
      1
    );
    t.is(
      output.granuleDuplicates[output.granules[0].granuleId].files[0].key,
      output.granules[0].files[0].key
    );

    const currentFileInfo = (await getFilesMetadata(output.granules[0].files))[0];
    t.is(currentFileInfo.size, randomString().length);
    t.true(currentFileInfo.LastModified >= existingFileInfo.LastModified);
  } finally {
    recursivelyDeleteS3Bucket(t.context.event.config.provider.host);
  }
}

test.serial('when duplicateHandling is "replace", do overwrite files', async (t) => {
  setupDuplicateHandlingConfig(t, 'replace');
  await granuleFilesOverwrittenTest(t);
});

test.serial('when duplicateHandling is "error" and forceDuplicateOverwrite is true, do overwrite files', async (t) => {
  setupDuplicateHandlingConfig(t, 'error', true);
  await granuleFilesOverwrittenTest(t);
});

test.serial('when duplicateHandling is "skip" and forceDuplicateOverwrite is true, do overwrite files', async (t) => {
  setupDuplicateHandlingConfig(t, 'skip', true);
  await granuleFilesOverwrittenTest(t);
});

test.serial('when duplicateHandling is "version" and forceDuplicateOverwrite is true, do overwrite files', async (t) => {
  setupDuplicateHandlingConfig(t, 'version', true);
  await granuleFilesOverwrittenTest(t);
});

test.serial('when duplicateHandling is "replace" and forceDuplicateOverwrite is true, do overwrite files', async (t) => {
  setupDuplicateHandlingConfig(t, 'replace', true);
  await granuleFilesOverwrittenTest(t);
});

test.serial('when duplicateHandling is specified as "replace" via collection, do overwrite files', async (t) => {
  setupDuplicateHandlingCollection(t, 'replace');
  await granuleFilesOverwrittenTest(t);
});

test.serial('download multiple granules from S3 provider to staging directory', async (t) => {
  t.context.event.input.granules = t.context.event_multigran.input.granules;
  try {
    await prepareS3DownloadEvent(t);

    const output = await syncGranule(t.context.event);

    await validateOutput(t, output);

    t.is(output.granules.length, 3);

    const config = t.context.event.config;

    // verify the files are downloaded to the correct staging area
    for (let i = 0; i < output.granules.length; i += 1) {
      for (let j = 0; j < output.granules[i].files.length; j += 1) {
        const collectionId = constructCollectionId(
          output.granules[i].dataType, output.granules[i].version
        );
        const keypath = `${config.fileStagingDir}/${config.stack}/${collectionId}`;
        const granuleFileName = t.context.event.input.granules[i].files[j].name;
        t.is(
          `${output.granules[i].files[j].bucket}/${output.granules[i].files[j].key}`,
          `${t.context.internalBucketName}/${keypath}/${granuleFileName}`
        );

        t.true(
          // eslint-disable-next-line no-await-in-loop
          await s3ObjectExists({
            Bucket: t.context.internalBucketName,
            Key: `${keypath}/${granuleFileName}`,
          })
        );
      }
    }
  } finally {
    // Clean up
    recursivelyDeleteS3Bucket(t.context.event.config.provider.host);
  }
});
