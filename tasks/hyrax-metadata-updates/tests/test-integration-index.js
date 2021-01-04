'use strict';

const delay = require('delay');
const pRetry = require('p-retry');
const nock = require('nock');
const { promisify } = require('util');
const test = require('ava');
const proxyquire = require('proxyquire');
const fs = require('fs');
const xml2js = require('xml2js');
const pickAll = require('lodash/fp/pickAll');

const xmlParseOptions = {
  ignoreAttrs: true,
  mergeAttrs: true,
  explicitArray: false,
};

const { s3, secretsManager } = require('@cumulus/aws-client/services');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const path = require('path');
const {
  buildS3Uri,
  recursivelyDeleteS3Bucket,
  promiseS3Upload,
  parseS3Uri,
  getObject,
} = require('@cumulus/aws-client/S3');
const { InvalidArgument } = require('@cumulus/errors');
const ValidationError = require('@cumulus/cmr-client/ValidationError');
const { RecordDoesNotExist } = require('@cumulus/errors');

const rewire = require('rewire');

const HyraxMetadataUpdate = rewire('../index');

const generateHyraxUrl = HyraxMetadataUpdate.__get__('generateHyraxUrl');
const generatePath = HyraxMetadataUpdate.__get__('generatePath');
const getEntryTitle = HyraxMetadataUpdate.__get__('getEntryTitle');

const preconditionFailedSelector = {
  code: 'PreconditionFailed',
  statusCode: 412,
  message: 'At least one of the pre-conditions you specified did not hold',
};

const { hyraxMetadataUpdate } = proxyquire(
  '..',
  {
    '@cumulus/aws-client/S3': {
      waitForObject: (s3Client, params, retryOptions) =>
        pRetry(
          async () => {
            const result = await getObject(s3Client, params);

            // LocalStack does not handle pre-condition checks, so we have to
            // manually check, and throw, if necessary.
            if (params.IfMatch && result.ETag !== params.IfMatch) {
              throw Object.assign(new Error(), preconditionFailedSelector);
            }

            return result;
          },
          // Reduce number of retries to reduce test times
          { ...retryOptions, retries: 2 }
        ),
    },
  }
);

const cmrPasswordSecret = randomId('cmrPassword');

test.before(async () => {
  await secretsManager().createSecret({
    Name: cmrPasswordSecret,
    SecretString: randomId('cmrPasswordSecret'),
  }).promise();
});

test.beforeEach(() => {
  // Mock out retrieval of entryTitle from CMR
  const headers = { 'cmr-hits': 1, 'Content-Type': 'application/json;charset=utf-8' };
  nock('https://cmr.earthdata.nasa.gov').get('/search/collections.json')
    .query({
      short_name: 'GLDAS_CLSM025_D',
      version: '2.0',
      page_size: '50',
      page_num: '1',
      provider_short_name: 'GES_DISC',
    })
    .replyWithFile(200, 'tests/data/cmr-results.json', headers);

  nock('https://cmr.earthdata.nasa.gov')
    .post('/legacy-services/rest/tokens')
    .reply(200, { token: 'ABCDE' });

  process.env.CMR_ENVIRONMENT = 'OPS';
});

test.afterEach.always(() => {
  nock.cleanAll();
  delete process.env.CMR_ENVIRONMENT;
});

test.after.always(async () => {
  await secretsManager().deleteSecret({
    SecretId: cmrPasswordSecret,
    ForceDeleteWithoutRecovery: true,
  }).promise();
});

async function uploadFilesXml(files, bucket) {
  await Promise.all(files.map((file) => promiseS3Upload({
    Bucket: bucket,
    Key: parseS3Uri(file).Key,
    Body: file.endsWith('.cmr.xml')
      ? fs.createReadStream('tests/data/echo10in.xml') : parseS3Uri(file).Key,
  })));
}

async function uploadFilesJson(files, bucket) {
  await Promise.all(files.map((file) => promiseS3Upload({
    Bucket: bucket,
    Key: parseS3Uri(file).Key,
    Body: file.endsWith('.cmr.json')
      ? fs.createReadStream('tests/data/umm-gin.json') : parseS3Uri(file).Key,
  })));
}

function granulesToFileURIs(granules) {
  const s3URIs = granules.reduce((arr, g) => arr.concat(g.files.map((file) => file.filename)), []);
  return s3URIs;
}

function buildPayload(t) {
  const newPayload = t.context.payload;

  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal.name = t.context.stagingBucket;

  newPayload.input.granules.forEach((gran) => {
    gran.files.forEach((file) => {
      file.bucket = t.context.stagingBucket;
      file.filename = buildS3Uri(t.context.stagingBucket, parseS3Uri(file.filename).Key);
    });
  });

  return newPayload;
}

async function setupS3(t, isUmmG) {
  t.context.stagingBucket = randomId('staging');

  await s3().createBucket({ Bucket: t.context.stagingBucket }).promise();

  const filename = isUmmG ? 'payload-json.json' : 'payload-xml.json';
  const payloadPath = path.join(__dirname, 'data', filename);
  const rawPayload = fs.readFileSync(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(t.context.payload.input.granules);
  t.context.filesToUpload = filesToUpload.map((file) =>
    buildS3Uri(`${t.context.stagingBucket}`, parseS3Uri(file).Key));
  buildPayload(t);
  if (isUmmG) {
    await uploadFilesJson(filesToUpload, t.context.stagingBucket);
  } else {
    await uploadFilesXml(filesToUpload, t.context.stagingBucket);
  }
}

const event = {
  config: {
    cmr: {
      oauthProvider: 'earthdata',
      provider: 'GES_DISC',
      clientId: 'xxxxxx',
      username: 'xxxxxx',
      passwordSecretName: cmrPasswordSecret,
    },
  },
  input: {},
};

test.serial('Test updating ECHO10 metadata file in S3', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov')
    .post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml')
    .reply(200);
  await setupS3(t, false);

  const e = {
    config: event.config,
    input: t.context.payload.input,
  };

  try {
    await hyraxMetadataUpdate(e);

    // Verify the metadata has been updated at the S3 location
    const metadataFile = t.context.payload.input.granules[0].files.find((f) =>
      f.type === 'metadata');
    const actual = await getObject(s3(), {
      Bucket: `${metadataFile.bucket}/${metadataFile.fileStagingDir}`,
      Key: metadataFile.name,
    });
    const expected = fs.readFileSync('tests/data/echo10out.xml', 'utf8');

    t.is(actual.Body.toString(), expected);
  } finally {
    await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  }
});

test.serial('hyraxMetadataUpdate immediately finds and updates ECHO10 metadata file with incoming etag', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov')
    .post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml')
    .reply(200);

  await setupS3(t, false);

  const e = {
    config: event.config,
    input: t.context.payload.input,
  };

  try {
    const metadataFile = t.context.payload.input.granules[0].files.find((f) =>
      f.type === 'metadata');
    const { ETag: inputEtag } = await getObject(s3(), {
      Bucket: `${metadataFile.bucket}/${metadataFile.fileStagingDir}`,
      Key: metadataFile.name,
    });
    metadataFile.etag = inputEtag;

    const { granules } = await hyraxMetadataUpdate(e);

    const { etag: outputEtag } = granules[0].files.find((f) =>
      f.type === 'metadata');
    // Verify the metadata has been updated at the S3 location
    const actual = await getObject(s3(), {
      Bucket: `${metadataFile.bucket}/${metadataFile.fileStagingDir}`,
      Key: metadataFile.name,
    });
    const actualPartial = {
      etag: actual.ETag,
      body: actual.Body.toString(),
    };
    const expectedPartial = {
      etag: outputEtag,
      body: fs.readFileSync('tests/data/echo10out.xml', 'utf8'),
    };

    t.not(outputEtag, inputEtag);
    t.deepEqual(actualPartial, expectedPartial);
  } finally {
    await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  }
});

test.serial('hyraxMetadataUpdate eventually finds and updates ECHO10 metadata file with incoming etag', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov')
    .post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml')
    .reply(200);

  await setupS3(t, false);

  const e = {
    config: event.config,
    input: t.context.payload.input,
  };

  try {
    const metadataFile = t.context.payload.input.granules[0].files.find((f) =>
      f.type === 'metadata');
    const bucket = `${metadataFile.bucket}/${metadataFile.fileStagingDir}`;
    const { ETag: inputEtag } = await getObject(s3(), {
      Bucket: bucket,
      Key: metadataFile.name,
    });
    metadataFile.etag = inputEtag;

    // Upload dummy file to force retries in hyraxMetadataUpdate because ETag is
    // not initially matched.
    await promiseS3Upload({
      Bucket: bucket,
      Key: metadataFile.name,
      Body: 'foo',
    });

    const granulesPromise = hyraxMetadataUpdate(e);
    await delay(3000).then(promiseS3Upload({
      Bucket: bucket,
      Key: metadataFile.name,
      Body: fs.createReadStream('tests/data/echo10in.xml'),
    }));
    const { granules } = await granulesPromise;

    const { etag: outputEtag } = granules[0].files.find((f) =>
      f.type === 'metadata');
    // Verify the metadata has been updated at the S3 location
    const actual = await getObject(s3(), {
      Bucket: `${metadataFile.bucket}/${metadataFile.fileStagingDir}`,
      Key: metadataFile.name,
    });
    const actualPartial = {
      etag: actual.ETag,
      body: actual.Body.toString(),
    };
    const expectedPartial = {
      etag: outputEtag,
      body: fs.readFileSync('tests/data/echo10out.xml', 'utf8'),
    };

    t.not(outputEtag, inputEtag);
    t.deepEqual(actualPartial, expectedPartial);
  } finally {
    await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  }
});

test.serial('hyraxMetadataUpdate fails with PreconditionFailure when metadata with incoming etag cannot be found', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov')
    .post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml')
    .reply(200);

  await setupS3(t, false);

  const e = {
    config: event.config,
    input: t.context.payload.input,
  };

  try {
    const metadataFile = t.context.payload.input.granules[0].files.find((f) =>
      f.type === 'metadata');
    metadataFile.etag = randomString();

    const error = await t.throwsAsync(hyraxMetadataUpdate(e));

    t.deepEqual(pickAll(Object.keys(preconditionFailedSelector), error),
      preconditionFailedSelector);
  } finally {
    await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  }
});

test.serial('Test updating UMM-G metadata file in S3', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov')
    .post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.json')
    .reply(200);

  await setupS3(t, true);

  const e = {
    config: event.config,
    input: t.context.payload.input,
  };

  try {
    await hyraxMetadataUpdate(e);

    // Verify the metadata has been updated at the S3 location
    const metadataFile = t.context.payload.input.granules[0].files.find((f) =>
      f.type === 'metadata');
    const actual = await getObject(s3(), {
      Bucket: `${metadataFile.bucket}/${metadataFile.fileStagingDir}`,
      Key: metadataFile.name,
    });
    const expected = fs.readFileSync('tests/data/umm-gout.json', 'utf8');
    // We do this dance because formatting.
    const expectedString = JSON.stringify(JSON.parse(expected), undefined, 2);
    const actualString = JSON.stringify(JSON.parse(actual.Body.toString()),
      undefined, 2);

    t.is(actualString, expectedString);
  } finally {
    await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  }
});

test.serial('hyraxMetadataUpdate immediately finds and updates UMM-G metadata file with incoming etag', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov')
    .post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.json')
    .reply(200);

  await setupS3(t, true);

  const e = {
    config: event.config,
    input: t.context.payload.input,
  };

  try {
    const metadataFile = t.context.payload.input.granules[0].files.find((f) =>
      f.type === 'metadata');
    const { ETag: inputEtag } = await getObject(s3(), {
      Bucket: `${metadataFile.bucket}/${metadataFile.fileStagingDir}`,
      Key: metadataFile.name,
    });
    metadataFile.etag = inputEtag;

    const { granules } = await hyraxMetadataUpdate(e);

    const { etag: outputEtag } = granules[0].files.find((f) =>
      f.type === 'metadata');
    // Verify the metadata has been updated at the S3 location
    const actual = await getObject(s3(), {
      Bucket: `${metadataFile.bucket}/${metadataFile.fileStagingDir}`,
      Key: metadataFile.name,
    });
    // We do this dance because formatting.
    const normalizeBody = (body) => JSON.stringify(JSON.parse(body), undefined,
      2);
    const actualPartial = {
      etag: actual.ETag,
      body: normalizeBody(actual.Body.toString()),
    };
    const expectedPartial = {
      etag: outputEtag,
      body: normalizeBody(fs.readFileSync('tests/data/umm-gout.json', 'utf8')),
    };

    t.not(outputEtag, inputEtag);
    t.deepEqual(actualPartial, expectedPartial);
  } finally {
    await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  }
});

test.serial('Test validation error when updating UMM-G metadata file in S3', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov').post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.json')
    .reply(400);
  await setupS3(t, true);
  const e = {
    config: event.config,
    input: t.context.payload.input,
  };

  await t.throwsAsync(hyraxMetadataUpdate(e), {
    instanceOf: ValidationError,
    message: 'Validation was not successful, CMR error message: undefined',
  });

  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
});

test.serial('Test validation error when updating ECHO10 metadata file in S3', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov').post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml')
    .reply(400, '<?xml version="1.0" encoding="UTF-8"?><errors><error>foo</error></errors>');
  await setupS3(t, false);

  const e = {
    config: event.config,
    input: t.context.payload.input,
  };

  await t.throwsAsync(hyraxMetadataUpdate(e), {
    instanceOf: ValidationError,
    message: 'Validation was not successful, CMR error message: "foo"',
  });

  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
});

test.serial('Test record does not exist error when granule object has no recognizable metadata files in it', async (t) => {
  await setupS3(t, true);
  const e = {
    config: event.config,
    input: {
      granules: [
        {
          granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
          files: [
            {
              name: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
              bucket: 'cumulus-internal',
              filename: 's3://cumulus-internal/file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
              type: 'data',
              fileStagingDir: 'file-staging/subdir',
            },
          ],
        },
      ],
    },
  };

  await t.throwsAsync(hyraxMetadataUpdate(e), {
    instanceOf: RecordDoesNotExist,
    message: new RegExp(e.input.granules[0].granuleId),
  });

  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
});

test.serial('Test retrieving entry title from CMR using UMM-G', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(data);
  const actual = await getEntryTitle(event.config, metadataObject, true);
  t.is(actual, 'Sentinel-6A%20MF%2FJason-CS%20L2%20Advanced%20Microwave%20Radiometer%20(AMR-C)%20NRT%20Geophysical%20Parameters');
});

test.serial('Test retrieving entry title from CMR using ECHO10', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const actual = await getEntryTitle(event.config, metadata, false);
  t.is(actual, 'Sentinel-6A%20MF%2FJason-CS%20L2%20Advanced%20Microwave%20Radiometer%20(AMR-C)%20NRT%20Geophysical%20Parameters');
});

test('Test generate path from UMM-G', async (t) => {
  const metadata = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(metadata);
  const actual = await generatePath(event.config, metadataObject, true);

  t.is(actual, 'providers/GES_DISC/collections/Sentinel-6A%20MF%2FJason-CS%20L2%20Advanced%20Microwave%20Radiometer%20(AMR-C)%20NRT%20Geophysical%20Parameters/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generate path from ECHO-10', async (t) => {
  const metadata = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadataObject = await (promisify(xml2js.parseString))(metadata, xmlParseOptions);

  const actual = await generatePath(event.config, metadataObject, false);

  t.is(actual, 'providers/GES_DISC/collections/Sentinel-6A%20MF%2FJason-CS%20L2%20Advanced%20Microwave%20Radiometer%20(AMR-C)%20NRT%20Geophysical%20Parameters/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generating OPeNDAP URL from ECHO10 file', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const actual = await generateHyraxUrl(event.config, metadata, false);
  t.is(actual, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/Sentinel-6A%20MF%2FJason-CS%20L2%20Advanced%20Microwave%20Radiometer%20(AMR-C)%20NRT%20Geophysical%20Parameters/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generating OPeNDAP URL from UMM-G file', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(data);
  const actual = await generateHyraxUrl(event.config, metadataObject, true);
  t.is(actual, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/Sentinel-6A%20MF%2FJason-CS%20L2%20Advanced%20Microwave%20Radiometer%20(AMR-C)%20NRT%20Geophysical%20Parameters/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generate path from ECHO-10 throws exception with broken config', async (t) => {
  const badEvent = {
    config: {
      cmr: {
        oauthProvider: 'earthdata',
        clientId: 'xxxxxx',
        username: 'xxxxxx',
        passwordSecretName: 'xxxxx',
      },
    },
    input: {},
  };
  const metadata = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadataObject = await (promisify(xml2js.parseString))(metadata, xmlParseOptions);
  await t.throwsAsync(generatePath(badEvent.config, metadataObject, false), {
    instanceOf: InvalidArgument,
    message: 'Provider not supplied in configuration. Unable to construct path',
  });
});
