'use strict';

const pRetry = require('p-retry');
const nock = require('nock');
const { promisify } = require('util');
const test = require('ava');
const proxyquire = require('proxyquire');
const fs = require('fs');
const xml2js = require('xml2js');

const xmlParseOptions = {
  ignoreAttrs: true,
  mergeAttrs: true,
  explicitArray: false,
};

const { s3, secretsManager } = require('@cumulus/aws-client/services');
const { randomId, randomString, validateInput, validateConfig, validateOutput } = require('@cumulus/common/test-utils');
const { createToken, buildGetTokensResponse } = require('@cumulus/cmr-client/tests/EarthdataLoginUtils');
const path = require('path');
const {
  buildS3Uri,
  recursivelyDeleteS3Bucket,
  promiseS3Upload,
  parseS3Uri,
  getObject,
  getObjectStreamContents,
} = require('@cumulus/aws-client/S3');
const { isCMRFile } = require('@cumulus/cmrjs');
const { InvalidArgument, ValidationError } = require('@cumulus/errors');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { sleep } = require('@cumulus/common');

const rewire = require('rewire');

const HyraxMetadataUpdate = rewire('../index');

const generateHyraxUrl = HyraxMetadataUpdate.__get__('generateHyraxUrl');
const generatePath = HyraxMetadataUpdate.__get__('generatePath');
const getCollectionEntry = HyraxMetadataUpdate.__get__('getCollectionEntry');

const preconditionFailedSelector = {
  name: 'PreconditionFailed',
  message: 'At least one of the pre-conditions you specified did not hold',
  $response: {
    statusCode: 412,
  },
};

const { hyraxMetadataUpdate } = proxyquire(
  '..',
  {
    '@cumulus/aws-client/S3': {
      waitForObject: (s3Client, params, retryOptions) =>
        pRetry(
          async () => {
            const result = await getObject(s3Client, params);

            // LocalStack does not handle pre-condition checks, so we have to manually check,
            // and throw, if necessary.
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

// We do this dance because formatting.
const normalizeBody = (body) => JSON.stringify(JSON.parse(body), undefined, 2);

test.before(async () => {
  await secretsManager().createSecret({
    Name: cmrPasswordSecret,
    SecretString: randomId('cmrPasswordSecret'),
  }).promise();
});

const setupNock = (params) => {
  const cmrParams = {
    ...params,
    page_size: '50',
    page_num: '1',
    provider_short_name: 'GES_DISC',
  };

  const expectedresponse = [
    {
      access_token: jwt.sign(
        { data: 'foobar' },
        randomId('secret'),
        { expiresIn: '1y' }
      ),
      token_type: 'Bearer',
      expiration_date: '1/1/2999',
    },
  ];

  // Mock out retrieval of collection entry from CMR
  const headers = { 'cmr-hits': 1, 'Content-Type': 'application/json;charset=utf-8' };
  nock('https://cmr.earthdata.nasa.gov').get('/search/collections.json')
    .query(cmrParams)
    .replyWithFile(200, 'tests/data/cmr-results.json', headers);

  nock('https://urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, expectedresponse);

  process.env.CMR_ENVIRONMENT = 'OPS';
};

test.beforeEach(() =>
  setupNock({
    short_name: 'GLDAS_CLSM025_D',
    version: '2.0',
  }));

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
    params: {
      Bucket: bucket,
      Key: parseS3Uri(file).Key,
      Body: file.endsWith('.cmr.xml')
        ? fs.createReadStream('tests/data/echo10in.xml') : parseS3Uri(file).Key,
    },
  })));
}

async function uploadFilesJson(files, bucket) {
  await Promise.all(files.map((file) => promiseS3Upload({
    params: {
      Bucket: bucket,
      Key: parseS3Uri(file).Key,
      Body: file.endsWith('.cmr.json')
        ? fs.createReadStream('tests/data/umm-gin.json') : parseS3Uri(file).Key,
    },
  })));
}

function granulesToFileURIs(bucket, granules) {
  const s3URIs = granules.reduce(
    (arr, g) => arr.concat(g.files.map((file) => buildS3Uri(bucket, file.key))),
    []
  );
  return s3URIs;
}

function buildPayload(t) {
  const newPayload = t.context.payload;

  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal.name = t.context.stagingBucket;

  newPayload.input.granules.forEach((gran) => {
    gran.files.forEach((file) => {
      file.bucket = t.context.stagingBucket;
    });
  });

  return newPayload;
}

async function setupS3(t, isUmmG) {
  t.context.stagingBucket = randomId('staging');

  await s3().createBucket({ Bucket: t.context.stagingBucket });

  const filename = isUmmG ? 'payload-json.json' : 'payload-xml.json';
  const payloadPath = path.join(__dirname, 'data', filename);
  const rawPayload = fs.readFileSync(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(
    t.context.stagingBucket,
    t.context.payload.input.granules
  );
  t.context.filesToUpload = filesToUpload;
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
    etags: {},
  },
  input: {},
};

/**
 * Test helper function to metadata and ETags are updated correctly
 *
 * @param {Object} params
 * @param {Object} params.metadataFile
 * @param {string} params.metadataFile.bucket - S3 bucket of metadata file
 * @param {string} params.metadataFile.key - S3 key of metadata file
 * @param {string} params.originalETag - Original ETag of metadata file
 * @param {Object} params.output - Output from Lambda function handler
 * @param {string} params.expectedBodyPath
 *   Local file path to expected body of generated metadata file
 * @param {Object} params.t - Ava test assertion client
 * @param {boolean} [params.isUMMG] - Whether CMR metadata is in the UMM-G format. Default: false.
 */
async function verifyUpdatedMetadata({
  metadataFile,
  originalETag,
  output,
  expectedBodyPath,
  t,
  isUMMG = false,
}) {
  const actual = await getObject(s3(), {
    Bucket: metadataFile.bucket,
    Key: metadataFile.key,
  });
  let expectedBody = fs.readFileSync(expectedBodyPath, 'utf8');
  if (!isUMMG) {
    expectedBody = expectedBody.trim('\n');
  }
  // We do this dance because formatting.
  const expectedString = isUMMG ? normalizeBody(expectedBody) : expectedBody;
  const actualBody = await getObjectStreamContents(actual.Body);
  const actualString = isUMMG ? normalizeBody(actualBody) : actualBody;

  t.is(actualString, expectedString);

  const outputEtag = output.etags[buildS3Uri(metadataFile.bucket, metadataFile.key)];
  // Verify the metadata has been updated at the S3 location
  const actualPartial = {
    etag: actual.ETag,
    body: actualString,
  };
  const expectedPartial = {
    etag: outputEtag,
    body: expectedString,
  };

  t.false([originalETag, undefined].includes(outputEtag));
  t.deepEqual(actualPartial, expectedPartial);
}

test.serial('Test failing granule with no metadata', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload-json-nometa.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);

  const e = {
    config: event.config,
    input: t.context.payload.input,
  };
  const granule = e.input.granules[0];

  const expectedError = {
    name: 'RecordDoesNotExist',
    message: `No recognizable CMR metadata file (*.cmr.xml or *.cmr.json) for granule ${granule.granuleId}. Set config.skipMetadataCheck to true to silence this error.`,
  };
  const error = await t.throwsAsync(hyraxMetadataUpdate(e));
  t.like(error, expectedError);
});

test.serial('Test passing granule with no metadata if config.skipMetadataCheck is true', async (t) => {
  const payloadPath = path.join(__dirname, 'data', 'payload-json-nometa.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);

  const e = {
    config: {
      ...event.config,
      skipMetadataCheck: true,
    },
    input: t.context.payload.input,
  };

  try {
    const output = await hyraxMetadataUpdate(e);
    await validateOutput(t, output);
    t.deepEqual(output.granules, e.input.granules);
    t.deepEqual(output.etags, event.config.etags);
  } catch (error) {
    console.log(error);
    t.fail(error);
  }
});

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
    const metadataFile = t.context.payload.input.granules[0].files.find((f) =>
      isCMRFile(f));
    const { ETag: inputEtag } = await getObject(s3(), {
      Bucket: metadataFile.bucket,
      Key: metadataFile.key,
    });

    const output = await hyraxMetadataUpdate(e);
    await validateOutput(t, output);

    // Verify the metadata has been updated at the S3 location
    const actual = await getObject(s3(), {
      Bucket: metadataFile.bucket,
      Key: metadataFile.key,
    });
    const expectedBodyPath = 'tests/data/echo10out.xml';
    const expected = fs.readFileSync(expectedBodyPath, 'utf8');

    t.is(await getObjectStreamContents(actual.Body), expected.trim('\n'));

    await verifyUpdatedMetadata({
      metadataFile,
      expectedBodyPath,
      inputEtag,
      output,
      t,
    });
  } finally {
    await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  }

  t.true(nock.isDone());
});

test.serial('Test updating ECHO10 metadata file in S3 with no etags config', async (t) => {
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
      isCMRFile(f));
    const { ETag: inputEtag } = await getObject(s3(), {
      Bucket: metadataFile.bucket,
      Key: metadataFile.key,
    });

    delete e.config.etags;

    const output = await hyraxMetadataUpdate(e);
    await validateOutput(t, output);

    // Verify the metadata has been updated at the S3 location
    const actual = await getObject(s3(), {
      Bucket: metadataFile.bucket,
      Key: metadataFile.key,
    });
    const expectedBodyPath = 'tests/data/echo10out.xml';
    const expected = fs.readFileSync(expectedBodyPath, 'utf8');

    t.is(await getObjectStreamContents(actual.Body), expected.trim('\n'));

    await verifyUpdatedMetadata({
      metadataFile,
      expectedBodyPath,
      inputEtag,
      output,
      t,
    });
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
  await validateInput(t, e.input);

  try {
    const metadataFile = t.context.payload.input.granules[0].files.find((f) =>
      isCMRFile(f));
    const { ETag: inputEtag } = await getObject(s3(), {
      Bucket: metadataFile.bucket,
      Key: metadataFile.key,
    });
    e.config.etags = { [buildS3Uri(metadataFile.bucket, metadataFile.key)]: inputEtag };
    await validateConfig(t, e.config);

    const output = await hyraxMetadataUpdate(e);
    await validateOutput(t, output);

    const expectedBodyPath = 'tests/data/echo10out.xml';
    await verifyUpdatedMetadata({
      metadataFile,
      expectedBodyPath,
      inputEtag,
      output,
      t,
    });
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
  await validateInput(t, e.input);

  try {
    const metadataFile = t.context.payload.input.granules[0].files.find((f) =>
      isCMRFile(f));
    const bucket = metadataFile.bucket;
    const { ETag: inputEtag } = await getObject(s3(), {
      Bucket: bucket,
      Key: metadataFile.key,
    });
    e.config.etags = { [buildS3Uri(bucket, metadataFile.key)]: inputEtag };
    await validateConfig(t, e.config);

    // Upload dummy file to force retries in hyraxMetadataUpdate
    // because ETag is not initially matched.
    await promiseS3Upload({
      params: {
        Bucket: bucket,
        Key: metadataFile.key,
        Body: 'foo',
      },
    });

    const granulesPromise = hyraxMetadataUpdate(e);
    await sleep(3000).then(promiseS3Upload({
      params: {
        Bucket: bucket,
        Key: metadataFile.key,
        Body: fs.createReadStream('tests/data/echo10in.xml'),
      },
    }));
    const output = await granulesPromise;
    await validateOutput(t, output);

    const expectedBodyPath = 'tests/data/echo10out.xml';
    await verifyUpdatedMetadata({
      metadataFile,
      expectedBodyPath,
      inputEtag,
      output,
      t,
    });
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
  await validateInput(t, e.input);
  await validateConfig(t, e.config);

  try {
    const metadataFile = t.context.payload.input.granules[0].files.find((f) =>
      isCMRFile(f));
    e.config.etags[buildS3Uri(metadataFile.bucket, metadataFile.key)] = randomString();

    const error = await t.throwsAsync(hyraxMetadataUpdate(e));

    t.like(
      error,
      preconditionFailedSelector
    );
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
  await validateInput(t, e.input);
  await validateConfig(t, e.config);

  try {
    const metadataFile = t.context.payload.input.granules[0].files.find((f) =>
      isCMRFile(f));
    const { ETag: inputEtag } = await getObject(s3(), {
      Bucket: metadataFile.bucket,
      Key: metadataFile.key,
    });

    const output = await hyraxMetadataUpdate(e);
    await validateOutput(t, output);

    await verifyUpdatedMetadata({
      metadataFile,
      expectedBodyPath: 'tests/data/umm-gout.json',
      inputEtag,
      output,
      t,
      isUMMG: true,
    });
  } finally {
    await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  }

  t.true(nock.isDone());
});

test.serial('Test updating UMM-G metadata file in S3 with no etags config', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov')
    .post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.json')
    .reply(200);

  await setupS3(t, true);

  const e = {
    config: event.config,
    input: t.context.payload.input,
  };
  await validateInput(t, e.input);
  await validateConfig(t, e.config);

  delete e.config.etags;

  try {
    const metadataFile = t.context.payload.input.granules[0].files.find((f) =>
      isCMRFile(f));
    const { ETag: inputEtag } = await getObject(s3(), {
      Bucket: metadataFile.bucket,
      Key: metadataFile.key,
    });

    const output = await hyraxMetadataUpdate(e);
    await validateOutput(t, output);

    await verifyUpdatedMetadata({
      metadataFile,
      expectedBodyPath: 'tests/data/umm-gout.json',
      inputEtag,
      output,
      t,
      isUMMG: true,
    });
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
  await validateInput(t, e.input);

  try {
    const metadataFile = t.context.payload.input.granules[0].files.find((f) =>
      isCMRFile(f));
    const { ETag: inputEtag } = await getObject(s3(), {
      Bucket: metadataFile.bucket,
      Key: metadataFile.key,
    });
    e.config.etags = { [buildS3Uri(metadataFile.bucket, metadataFile.key)]: inputEtag };
    await validateConfig(t, e.config);

    const output = await hyraxMetadataUpdate(e);
    await validateOutput(t, output);

    await verifyUpdatedMetadata({
      metadataFile,
      expectedBodyPath: 'tests/data/umm-gout.json',
      inputEtag,
      output,
      t,
      isUMMG: true,
    });
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

test.serial('hyraxMetadataUpdate skips ECHO10 metadata validation when skipMetadataValidation is set to true', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov')
    .post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml')
    .reply(400);
  await setupS3(t, false);

  const e = {
    config: {
      ...event.config,
      skipMetadataValidation: true,
    },
    input: t.context.payload.input,
  };

  try {
    const output = await hyraxMetadataUpdate(e);
    await validateOutput(t, output);
  } finally {
    await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  }

  t.false(nock.isDone());
});

test.serial('hyraxMetadataUpdate skips UMM-G metadata validation when skipMetadataValidation is set to true', async (t) => {
  // Set up mock Validation call to CMR
  nock('https://cmr.earthdata.nasa.gov')
    .post('/ingest/providers/GES_DISC/validate/granule/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.json')
    .reply(400);
  await setupS3(t, true);

  const e = {
    config: {
      ...event.config,
      skipMetadataValidation: true,
    },
    input: t.context.payload.input,
  };

  try {
    const output = await hyraxMetadataUpdate(e);
    await validateOutput(t, output);
  } finally {
    await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  }

  t.false(nock.isDone());
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
              bucket: 'cumulus-internal',
              key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
              type: 'data',
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

test.serial('Test retrieving optional entry collection from CMR using UMM-G', async (t) => {
  const optionalEvent = {
    config: {
      cmr: {
        oauthProvider: 'earthdata',
        provider: 'GES_DISC',
        clientId: 'xxxxxx',
        username: 'xxxxxx',
        passwordSecretName: cmrPasswordSecret,
      },
      etags: {},
      addShortnameAndVersionIdToConceptId: true,
    },
    input: {},
  };
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(data);
  const actual = await getCollectionEntry(optionalEvent.config, metadataObject, true);
  t.is(actual, 'C1453188197-GES_DISC/GLDAS_CLSM025_D.2.0');
});

test.serial('Test retrieving default entry collection from CMR using UMM-G with ShortName and Version', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(data);

  const actual = await getCollectionEntry(event.config, metadataObject, true);
  t.is(actual, 'C1453188197-GES_DISC');
});

test.serial('Test retrieving default entry collection from CMR using UMM-G with EntryTitle', async (t) => {
  setupNock({ dataset_id: 'GLDAS_CLSM025_D_2.0' });
  const data = fs.readFileSync('tests/data/umm-g-entry-title-in.json', 'utf8');
  const metadataObject = JSON.parse(data);

  const actual = await getCollectionEntry(event.config, metadataObject, true);
  t.is(actual, 'C1453188197-GES_DISC');
});

test.serial('Test retrieving entry collection from CMR using ECHO10 with ShortName and VersionId', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const actual = await getCollectionEntry(event.config, metadata, false);
  t.is(actual, 'C1453188197-GES_DISC');
});

test.serial('Test retrieving entry collection from CMR using ECHO10 with DataSetId', async (t) => {
  setupNock({ dataset_id: 'GLDAS_CLSM025_D_2.0' });
  const data = fs.readFileSync('tests/data/echo10-dataset_id-in.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const actual = await getCollectionEntry(event.config, metadata, false);
  t.is(actual, 'C1453188197-GES_DISC');
});

test('Test generate path from UMM-G', async (t) => {
  const metadata = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(metadata);
  const actual = await generatePath(event.config, metadataObject, true);
  t.is(actual, 'collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generate path from ECHO-10', async (t) => {
  const metadata = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadataObject = await (promisify(xml2js.parseString))(metadata, xmlParseOptions);
  const actual = await generatePath(event.config, metadataObject, false);
  t.is(actual, 'collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generating OPeNDAP URL from ECHO10 file', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const metadata = await (promisify(xml2js.parseString))(data, xmlParseOptions);
  const actual = await generateHyraxUrl(event.config, metadata, false);
  t.is(actual, 'https://opendap.earthdata.nasa.gov/collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generating OPeNDAP URL from UMM-G file', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const metadataObject = JSON.parse(data);
  const actual = await generateHyraxUrl(event.config, metadataObject, true);
  t.is(actual, 'https://opendap.earthdata.nasa.gov/collections/C1453188197-GES_DISC/granules/GLDAS_CLSM025_D.2.0%3AGLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generate path from ECHO-10 throws exception with broken config', async (t) => {
  const badEvent = {
    config: {
      cmr: {
        oauthProvider: 'earthdata',
        clientId: 'xxxxxx',
        username: 'xxxxxx',
        passwordSecretName: cmrPasswordSecret,
      },
      etags: {},
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
