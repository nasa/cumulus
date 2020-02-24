'use strict';

const test = require('ava');
const fs = require('fs');
const HyraxMetadataUpdate = require('..');

// Unit tests
test('Test return prod OPeNDAP host when no environment value supplied', async (t) => {

  const data = await HyraxMetadataUpdate.generateAddress('prod');

  t.is(data, 'https://opendap.earthdata.nasa.gov');
});

test('Test return sit OPeNDAP host when sit environment value supplied', async (t) => {
  const data = await HyraxMetadataUpdate.generateAddress('sit');

  t.is(data, 'https://opendap.sit.earthdata.nasa.gov');
});

test('Test return uat OPeNDAP host when uat environment value supplied', async (t) => {
  const data = await HyraxMetadataUpdate.generateAddress('uat');

  t.is(data, 'https://opendap.uat.earthdata.nasa.gov');
});

test('Test return error when invalid environment supplied for host generation', async (t) => {

  const error = await t.throws(
    () => HyraxMetadataUpdate.generateAddress('foo')
  );

  t.is(error.message, 'Environment foo is not a valid environment.');
});

test('Test generate path from UMM-G', async (t) => {
  const event = {
    config: {
      provider: 'GES_DISC',
      entryTitle: 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC'
    },
    input: {}
  };
  const data = await HyraxMetadataUpdate.generatePath(event, fs.readFileSync('tests/data/umm-gin.json', 'utf8'));

  t.is(data, 'providers/GES_DISC/collections/GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test generate path from ECHO-10', async (t) => {
  const event = {
    config: {
      provider: 'GES_DISC',
      entryTitle: 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC'
    },
    input: {}
  };
  const data = await HyraxMetadataUpdate.generatePath(event, fs.readFileSync('tests/data/echo10in.xml', 'utf8'));

  t.is(data, 'providers/GES_DISC/collections/GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test return error when invalid provider supplied for path generation', async (t) => {
  const event = {
    config: { entryTitle: 'GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC' },
    input: {}
  };
  const error = await t.throws(
    () => HyraxMetadataUpdate.generatePath(event, fs.readFileSync('tests/data/umm-gin.json', 'utf8'))
  );

  t.is(error.message, 'Provider not supplied in configuration. Unable to construct path');
});

test('Test return error when invalid entry title supplied for path generation', async (t) => {
  const event = {
    config: { provider: 'GES_DISC' },
    input: {}
  };
  const error = await t.throws(
    () => HyraxMetadataUpdate.generatePath(event, fs.readFileSync('tests/data/umm-gin.json', 'utf8'))
  );

  t.is(error.message, 'Entry Title not supplied in configuration. Unable to construct path');
});

test('Test native id extraction from UMM-G', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');

  const result = await HyraxMetadataUpdate.getNativeId(data);

  t.is(result, 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test native id extraction from ECHO10', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');

  const result = await HyraxMetadataUpdate.getNativeId(data);

  t.is(result, 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test adding OPeNDAP URL to UMM-G file', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const expected = fs.readFileSync('tests/data/umm-gout.json', 'utf8');
  const expectedObject = JSON.parse(expected);
  const result = await HyraxMetadataUpdate.addHyraxUrl(data, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(result, JSON.stringify(expectedObject, null, 2));
});

test('Test adding OPeNDAP URL to UMM-G file with no related urls', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin-no-related-urls.json', 'utf8');
  const expected = fs.readFileSync('tests/data/umm-gout-no-related-urls.json', 'utf8');
  const expectedObject = JSON.parse(expected);
  const result = await HyraxMetadataUpdate.addHyraxUrl(data, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(result, JSON.stringify(expectedObject, null, 2));
});

test('Test adding OPeNDAP URL to ECHO10 file', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const expected = fs.readFileSync('tests/data/echo10out.xml', 'utf8');
  const result = await HyraxMetadataUpdate.addHyraxUrl(data, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(result, expected);
});

test('Test adding OPeNDAP URL to ECHO10 file with no OnlineResources', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in-no-online-resource-urls.xml', 'utf8');
  const expected = fs.readFileSync('tests/data/echo10out-no-online-resource-urls.xml', 'utf8');
  const result = await HyraxMetadataUpdate.addHyraxUrl(data, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(result, expected);
});

// Integration tests

/* async function uploadEcho10MetadataFiles(files, bucket) {
  await Promise.all(files.map((file) => promiseS3Upload({
    Bucket: bucket,
    Key: parseS3Uri(file).Key,
    Body: file.endsWith('.cmr.xml')
      ? fs.createReadStream('tests/data/echo10in.xml') : parseS3Uri(file).Key
  })));
}

async function uploadUmmGMetadataFiles(files, bucket) {
  await Promise.all(files.map((file) => promiseS3Upload({
    Bucket: bucket,
    Key: parseS3Uri(file).Key,
    Body: file.endsWith('.cmr.json')
      ? fs.createReadStream('tests/data/ummgin.json') : parseS3Uri(file).Key
  })));
}

function buildPayload(t) {
  const newPayload = t.context.payload;

  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal.name = t.context.stagingBucket;
  newPayload.config.buckets.public.name = t.context.publicBucket;
  newPayload.config.buckets.protected.name = t.context.protectedBucket;

  newPayload.input.granules.forEach((gran) => {
    gran.files.forEach((file) => {
      file.bucket = t.context.stagingBucket;
      file.filename = buildS3Uri(t.context.stagingBucket, parseS3Uri(file.filename).Key);
    });
  });

  return newPayload;
}

function getExpectedOutputFileNames(t) {
  return [
    `s3://${t.context.protectedBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf`,
    `s3://${t.context.publicBucket}/jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
    `s3://${t.context.publicBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
    `s3://${t.context.publicBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`
  ];
}

async function getMetadataFile(files) {
  const getFileRequests = files.map(async (f) => {
    const s3list = await listS3ObjectsV2(
      { Bucket: f.bucket, Prefix: parseS3Uri(f.filename).Key }
    );
    const s3object = s3list.filter((s3file) => s3file.Key === parseS3Uri(f.filename).Key);

    return {
      filename: f.filename,
      size: s3object[0].Size,
      LastModified: s3object[0].LastModified
    };
  });
  return Promise.all(getFileRequests);
}

test.beforeEach(async (t) => {
  t.context.stagingBucket = randomId('staging');
  t.context.publicBucket = randomId('public');
  t.context.protectedBucket = randomId('protected');
  await Promise.all([
    s3().createBucket({ Bucket: t.context.stagingBucket }).promise(),
    s3().createBucket({ Bucket: t.context.publicBucket }).promise(),
    s3().createBucket({ Bucket: t.context.protectedBucket }).promise()
  ]);

  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = await readFile(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(t.context.payload.input.granules);
  t.context.filesToUpload = filesToUpload.map((file) =>
    buildS3Uri(`${t.context.stagingBucket}`, parseS3Uri(file).Key));
  process.env.REINGEST_GRANULE = false;
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.publicBucket);
  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  await recursivelyDeleteS3Bucket(t.context.protectedBucket);
});

test.serial('Should update ECHO10 metadata files with Hyrax URL.', async (t) => {
  const newPayload = buildPayload(t);
  const filesToUpload = clonedeep(t.context.filesToUpload);
  await uploadEcho10MetadataFiles(filesToUpload, t.context.stagingBucket);

  const output = await hyraxMetadataUpdate(newPayload);
  await validateOutput(t, output);
  // Check the the S3 file has been updated correctly
  const actual = await s3ReadObject({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  });
  const expected = fs.readFileSync('tests/data/echo10out.xml', 'utf8');
  t.is(actual, expected);
});

test.serial('Should update UMM-G metadata files with Hyrax URL.', async (t) => {
  const newPayload = buildPayload(t);
  const filesToUpload = clonedeep(t.context.filesToUpload);
  await uploadEcho10MetadataFiles(filesToUpload, t.context.stagingBucket);

  const output = await hyraxMetadataUpdate(newPayload);
  await validateOutput(t, output);
  // Check the the S3 file has been updated correctly
  const actual = await s3ReadObject({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  });
  const expected = fs.readFileSync('tests/data/umm-gout.xml', 'utf8');
  t.is(actual, expected);
});

 */