'use strict';

const test = require('ava');
const sinon = require('sinon');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const {
  randomString,
  validateConfig,
  validateInput,
  validateOutput,
} = require('@cumulus/common/test-utils');
const { PDRParsingError } = require('@cumulus/errors');
const { streamTestData } = require('@cumulus/test-data');
const proxyquire = require('proxyquire');

const fakeCollectionsApi = {};
const fakeProvidersApi = {};

const { parsePdr } = proxyquire(
  '..',
  {
    '@cumulus/api-client': {
      collections: fakeCollectionsApi,
      providers: fakeProvidersApi,
    },
  }
);

async function setUpTestPdrAndValidate(t) {
  return await Promise.all([
    s3PutObject({
      Bucket: t.context.payload.config.provider.host,
      Key: `${t.context.payload.input.pdr.path}/${t.context.payload.input.pdr.name}`,
      Body: streamTestData(`pdrs/${t.context.payload.input.pdr.name}`),
    }),
    validateInput(t, t.context.payload.input),
    validateConfig(t, t.context.payload.config),
  ]);
}

test.before(async (t) => {
  const testBucket = `internal-bucket-${randomString().slice(0, 6)}`;
  await createBucket(testBucket);
  t.context.stackName = `stack-${randomString().slice(0, 6)}`;

  const mod09CollectionConfig = {
    granuleIdExtraction: '^(.*)\.hdf',
  };
  const mod14CollectionConfig = {
    granuleIdExtraction: '^(MOD14A1.*\.401\..*)\.hdf',
  };
  const mod87CollectionConfig = {
    granuleIdExtraction: '^PENS-(.*)\.hdf',
  };

  t.context.sandbox = sinon.createSandbox();
  t.context.getCollectionsStub = t.context.sandbox.stub();
  fakeCollectionsApi.getCollection = t.context.getCollectionsStub;
  t.context.getCollectionsStub.withArgs({
    prefix: t.context.stackName,
    collectionName: 'MOD09GQ',
    collectionVersion: '006',
  }).resolves(mod09CollectionConfig);
  t.context.getCollectionsStub.withArgs({
    prefix: t.context.stackName,
    collectionName: 'MOD87GQ',
    collectionVersion: '006',
  }).resolves(mod87CollectionConfig);
  t.context.getCollectionsStub.withArgs({
    prefix: t.context.stackName,
    collectionName: 'MOD87GQ',
    collectionVersion: 'FAKE',
  }).resolves(mod09CollectionConfig);
  t.context.getCollectionsStub.withArgs({
    prefix: t.context.stackName,
    collectionName: 'MOD14A1',
    collectionVersion: '401',
  }).resolves(mod14CollectionConfig);

  t.context.payload = {
    config: {
      stack: t.context.stackName,
      bucket: testBucket,
      provider: {
        id: 'MODAPS',
        protocol: 's3',
        host: testBucket,
      },
    },
    input: {
      pdr: {
        name: '',
        path: '/pdrs',
      },
    },
  };
});

test.beforeEach(() => {
  fakeProvidersApi.getProviders = () => Promise.resolve({
    body: JSON.stringify({ results: [] }),
  });
});

test.after.always(async (t) => {
  t.context.sandbox.restore();
  await recursivelyDeleteS3Bucket(t.context.payload.config.bucket);
});

test.serial('parse-pdr properly parses a simple PDR file', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  const result = await parsePdr(t.context.payload);
  await validateOutput(t, result).catch(t.fail);

  t.is(result.filesCount, 2);
  t.is(result.granulesCount, 1);
  t.is(result.granules.length, 1);
  t.is(result.totalSize, 17909733);

  const granule = result.granules[0];
  t.is(granule.dataType, 'MOD09GQ');
  t.is(granule.provider, undefined);

  const hdfFile = granule.files.find((file) => file.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
  t.truthy(hdfFile);
  t.is(hdfFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(hdfFile.size, 17865615);
  t.is(hdfFile.checksumType, 'CKSUM');
  t.is(hdfFile.checksum, 4208254019);
  t.is(hdfFile.type, 'data');

  const metFile = granule.files.find((file) => file.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf.met');
  t.truthy(metFile);
  t.is(metFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(metFile.size, 44118);
  t.is(metFile.type, 'metadata');
});

test.serial('parse-pdr properly parses simple PDR file with non-leading zero DATA_VERSION', async (t) => {
  t.context.payload.input.pdr.name = 'MOD14A1_401_granule.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  const result = await parsePdr(t.context.payload);
  await validateOutput(t, result).catch(t.fail);

  t.is(result.filesCount, 2);
  t.is(result.granulesCount, 1);
  t.is(result.granules.length, 1);
  t.is(result.totalSize, 17909733);

  // test MOD14 401 (non-leading zero DATA_VERSION)
  const mod14Granule = result.granules.find((granule) => granule.dataType === 'MOD14A1');
  t.truthy(mod14Granule);
  t.is(mod14Granule.granuleId, 'MOD14A1.A2017224.h09v02.401.2017227165020');
  t.is(mod14Granule.granuleSize, 17909733);

  const mod14HdfFile = mod14Granule.files.find((file) => file.name === 'MOD14A1.A2017224.h09v02.401.2017227165020.hdf');
  t.truthy(mod14HdfFile);
  t.is(mod14HdfFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(mod14HdfFile.size, 17865615);
  t.is(mod14HdfFile.checksumType, 'CKSUM');
  t.is(mod14HdfFile.checksum, 4208254019);
  t.is(mod14HdfFile.type, 'data');

  const mod14MetFile = mod14Granule.files.find((file) => file.name === 'MOD14A1.A2017224.h09v02.401.2017227165020.hdf.met');
  t.truthy(mod14MetFile);
  t.is(mod14MetFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(mod14MetFile.size, 44118);
  t.is(mod14MetFile.type, 'metadata');
});

test.serial('parse-pdr properly parses PDR with granules of different data-types', async (t) => {
  t.context.payload.input.pdr.name = 'multi-data-type.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  const result = await parsePdr(t.context.payload);
  await validateOutput(t, result).catch(t.fail);

  t.is(result.filesCount, 4);
  t.is(result.granulesCount, 2);
  t.is(result.granules.length, 2);
  t.is(result.totalSize, 35819466);
  // test MOD09 006
  const mod09Granule = result.granules.find((granule) => granule.dataType === 'MOD09GQ');
  t.truthy(mod09Granule);
  t.is(mod09Granule.granuleId, 'MOD09GQ.A2017224.h09v02.006.2017227165020');
  t.is(mod09Granule.granuleSize, 17909733);

  const mod09HdfFile = mod09Granule.files.find((file) => file.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
  t.truthy(mod09HdfFile);
  t.is(mod09HdfFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(mod09HdfFile.size, 17865615);
  t.is(mod09HdfFile.checksumType, 'CKSUM');
  t.is(mod09HdfFile.checksum, 4208254019);
  t.is(mod09HdfFile.type, 'data');

  const mod09MetFile = mod09Granule.files.find((file) => file.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf.met');
  t.truthy(mod09MetFile);
  t.is(mod09MetFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(mod09MetFile.size, 44118);
  t.is(mod09MetFile.type, 'metadata');
  // test MOD87 006
  const mod87Granule = result.granules.find((granule) => granule.dataType === 'MOD87GQ');
  t.truthy(mod87Granule);
  t.is(mod87Granule.granuleId, 'MOD87GQ.A2017224.h09v02.006.2017227165020');
  t.is(mod87Granule.granuleSize, 17909733);

  const mod87HdfFile = mod87Granule.files.find((file) => file.name === 'PENS-MOD87GQ.A2017224.h09v02.006.2017227165020.hdf');
  t.truthy(mod87HdfFile);
  t.is(mod87HdfFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(mod87HdfFile.size, 17865615);
  t.is(mod87HdfFile.checksumType, 'CKSUM');
  t.is(mod87HdfFile.checksum, 4208254019);
  t.is(mod87HdfFile.type, 'data');

  const mod87MetFile = mod87Granule.files.find((file) => file.name === 'PENS-MOD87GQ.A2017224.h09v02.006.2017227165020.hdf.met');
  t.truthy(mod87MetFile);
  t.is(mod87MetFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(mod87MetFile.size, 44118);
  t.is(mod87MetFile.type, 'metadata');
});

test.serial('parsePdr throws an exception if FILE_CKSUM_TYPE is set but FILE_CKSUM_VALUE is not', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-without-FILE_CKSUM_VALUE.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  await t.throwsAsync(
    parsePdr(t.context.payload),
    {
      instanceOf: PDRParsingError,
      message: 'MISSING FILE_CKSUM_VALUE PARAMETER',
    }
  );
});

test.serial('parsePdr throws an exception if FILE_CKSUM_VALUE is set but FILE_CKSUM_TYPE is not', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-without-FILE_CKSUM_TYPE.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  await t.throwsAsync(
    parsePdr(t.context.payload),
    {
      instanceOf: PDRParsingError,
      message: 'MISSING FILE_CKSUM_TYPE PARAMETER',
    }
  );
});

test.serial('parsePdr accepts an MD5 checksum', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-with-MD5-checksum.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  const result = await parsePdr(t.context.payload);
  await validateOutput(t, result).catch(t.fail);

  const fileWithChecksum = result.granules[0].files.find((file) => file.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
  t.is(fileWithChecksum.checksumType, 'MD5');
});

test.serial('parsePdr throws an exception if the value of an MD5 checksum is not a string', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-with-invalid-MD5-checksum.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  try {
    await parsePdr(t.context.payload);
    t.fail('Expected parsePdr to throw an error');
  } catch (error) {
    t.true(error.message.startsWith('Expected MD5 value to be a string'));
  }
});

test.serial('parsePdr throws an exception if the value of a CKSUM checksum is not a number', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-with-invalid-CKSUM-checksum.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  try {
    await parsePdr(t.context.payload);
    t.fail('Expected parsePdr to throw an error');
  } catch (error) {
    t.true(error.message.startsWith('Expected CKSUM value to be a number'));
  }
});

test.serial('parsePdr throws an exception if the a FILE_TYPE in the evaluated PDR is invalid', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-with-invalid-file-type.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  await t.throwsAsync(
    parsePdr(t.context.payload),
    {
      instanceOf: PDRParsingError,
      message: 'INVALID FILE_TYPE PARAMETER : INVALID',
    }
  );
});

test.serial('parse-pdr sets the provider of a granule with NODE_NAME set', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-with-NODE_NAME.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  const provider = { id: 'provider001', host: 'modpdr01' };

  fakeProvidersApi.getProviders = ({ prefix, queryStringParameters }) => {
    t.is(prefix, t.context.stackName);
    t.deepEqual(queryStringParameters, { host: provider.host });

    return Promise.resolve({
      body: JSON.stringify({
        results: [
          provider,
        ],
      }),
    });
  };

  const result = await parsePdr(t.context.payload);
  await validateOutput(t, result).catch(t.fail);

  t.is(result.granulesCount, 1);
  t.is(result.granules.length, 1);

  const granule = result.granules[0];

  t.deepEqual(granule.provider, provider.id);
});

test.serial('parse-pdr throws an exception if the provider specified in NODE_NAME does not exist', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-with-NODE_NAME.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  const provider = { host: 'modpdr01' };

  fakeProvidersApi.getProviders = ({ prefix, queryStringParameters }) => {
    t.is(prefix, t.context.stackName);
    t.deepEqual(queryStringParameters, { host: provider.host });

    return Promise.resolve({
      body: JSON.stringify({
        results: [],
      }),
    });
  };

  await t.throwsAsync(parsePdr(t.context.payload));
});

test.serial('parse-pdr throws an exception if multiple providers for the specified NODE_NAME exist', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-with-NODE_NAME.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  const host = 'modpdr01';

  fakeProvidersApi.getProviders = ({ prefix, queryStringParameters }) => {
    t.is(prefix, t.context.stackName);
    t.deepEqual(queryStringParameters, { host });

    return Promise.resolve({
      body: JSON.stringify({
        results: [
          { id: 'z', host },
          { id: 'y', host },
        ],
      }),
    });
  };

  await t.throwsAsync(parsePdr(t.context.payload));
});

test.serial(
  'parse-pdr "uniqueifies" granule when configured to do so',
  async (t) => {
    t.context.payload.input.pdr.name = 'multi-data-type.PDR';
    await setUpTestPdrAndValidate(t).catch(t.fail);

    const payload = structuredClone(t.context.payload);
    payload.config.uniquifyGranuleId = true;
    payload.config.hashLength = 3;
    const result = await parsePdr(payload);
    await validateOutput(t, result).catch(t.fail);

    t.deepEqual(
      {
        filesCount: result.filesCount,
        granulesCount: result.granulesCount,
        granulesLength: result.granules.length,
        totalSize: result.totalSize,
      },
      {
        filesCount: 4,
        granulesCount: 2,
        granulesLength: 2,
        totalSize: 35819466,
      },
      'Result metadata should match expected values'
    );

    const mod09Granule = result.granules.find(
      (granule) => granule.dataType === 'MOD09GQ'
    );
    t.truthy(mod09Granule, 'MOD09GQ granule should exist');
    const granuleHash1 = result.granules[0].granuleId.split('_')[1];
    const granuleHash2 = result.granules[1].granuleId.split('_')[1];

    t.deepEqual(
      {
        granuleId: mod09Granule.granuleId,
        granuleSize: mod09Granule.granuleSize,
        producerGranuleId: mod09Granule.producerGranuleId,
      },
      {
        granuleId: `MOD09GQ.A2017224.h09v02.006.2017227165020_${granuleHash1}`,
        granuleSize: 17909733,
        producerGranuleId: 'MOD09GQ.A2017224.h09v02.006.2017227165020',
      },
      'MOD09GQ granule metadata should match expected values'
    );

    const mod87Granule = result.granules.find(
      (granule) => granule.dataType === 'MOD87GQ'
    );
    t.truthy(mod87Granule, 'MOD87GQ granule should exist');
    t.deepEqual(
      {
        granuleId: mod87Granule.granuleId,
        granuleSize: mod87Granule.granuleSize,
        producerGranuleId: mod87Granule.producerGranuleId,
      },
      {
        granuleId: `MOD87GQ.A2017224.h09v02.006.2017227165020_${granuleHash2}`,
        granuleSize: 17909733,
        producerGranuleId: 'MOD87GQ.A2017224.h09v02.006.2017227165020',
      },
      'MOD87GQ granule metadata should match expected values'
    );
    t.is(payload.config.hashLength, granuleHash1.length);
    t.is(payload.config.hashLength, granuleHash2.length);
  }

);

test.serial(
  'parse-pdr "uniqueifies" granule when "uniquifyGranuleId" is set to "true"',
  async (t) => {
    t.context.payload.input.pdr.name = 'multi-data-type.PDR';
    await setUpTestPdrAndValidate(t).catch(t.fail);

    const payload = structuredClone(t.context.payload);
    payload.config.uniquifyGranuleId = 'true';
    const result = await parsePdr(payload);
    await validateOutput(t, result).catch(t.fail);

    t.deepEqual(
      {
        filesCount: result.filesCount,
        granulesCount: result.granulesCount,
        granulesLength: result.granules.length,
        totalSize: result.totalSize,
      },
      {
        filesCount: 4,
        granulesCount: 2,
        granulesLength: 2,
        totalSize: 35819466,
      },
      'Result metadata should match expected values'
    );

    const mod09Granule = result.granules.find(
      (granule) => granule.dataType === 'MOD09GQ'
    );
    t.truthy(mod09Granule, 'MOD09GQ granule should exist');
    t.is(mod09Granule.granuleId,
      `MOD09GQ.A2017224.h09v02.006.2017227165020_${result.granules[0].granuleId.split('_')[1]}`);
  }
);

test.serial(
  'parse-pdr "uniqueifies" granule when "uniquifyGranuleId" is set to "true" and incoming hashLength key is defined but nullish',
  async (t) => {
    t.context.payload.input.pdr.name = 'multi-data-type.PDR';
    await setUpTestPdrAndValidate(t).catch(t.fail);

    const payload = structuredClone(t.context.payload);
    payload.config.uniquifyGranuleId = 'true';
    payload.config.hashLength = undefined;
    const result = await parsePdr(payload);
    await validateOutput(t, result).catch(t.fail);

    t.deepEqual(
      {
        filesCount: result.filesCount,
        granulesCount: result.granulesCount,
        granulesLength: result.granules.length,
        totalSize: result.totalSize,
      },
      {
        filesCount: 4,
        granulesCount: 2,
        granulesLength: 2,
        totalSize: 35819466,
      },
      'Result metadata should match expected values'
    );

    const mod09Granule = result.granules.find(
      (granule) => granule.dataType === 'MOD09GQ'
    );
    t.truthy(mod09Granule, 'MOD09GQ granule should exist');
    t.is(mod09Granule.granuleId,
      `MOD09GQ.A2017224.h09v02.006.2017227165020_${result.granules[0].granuleId.split('_')[1]}`);
  }
);

test.serial(
  'parse-pdr handles ingest when two cross-collection granules have the same granule ID when uniquifyGranuleId set to "true"',
  async (t) => {
    t.context.payload.input.pdr.name = 'cross-collection-id-collision.PDR';
    await setUpTestPdrAndValidate(t).catch(t.fail);

    const payload = structuredClone(t.context.payload);
    payload.config.uniquifyGranuleId = true;
    const result = await parsePdr(payload);
    await validateOutput(t, result).catch(t.fail);

    t.deepEqual(
      {
        filesCount: result.filesCount,
        granulesCount: result.granulesCount,
        granulesLength: result.granules.length,
        totalSize: result.totalSize,
      },
      {
        filesCount: 4,
        granulesCount: 2,
        granulesLength: 2,
        totalSize: 35819466,
      },
      'Result metadata should match expected values'
    );

    const mod09Granule = result.granules.find(
      (granule) => granule.dataType === 'MOD09GQ'
    );
    t.truthy(mod09Granule, 'MOD09GQ granule should exist');
    t.deepEqual(
      {
        granuleId: mod09Granule.granuleId,
        granuleSize: mod09Granule.granuleSize,
        producerGranuleId: mod09Granule.producerGranuleId,
      },
      {
        granuleId: `MOD09GQ.A2017224.h09v02.006.2017227165020_${result.granules[0].granuleId.split('_')[1]}`,
        granuleSize: 17909733,
        producerGranuleId: 'MOD09GQ.A2017224.h09v02.006.2017227165020',
      },
      'MOD09GQ granule metadata should match expected values'
    );

    const mod87Granule = result.granules.find(
      (granule) => granule.dataType === 'MOD87GQ'
    );
    t.truthy(mod87Granule, 'MOD87GQ granule should exist');
    t.deepEqual(
      {
        granuleId: mod87Granule.granuleId,
        granuleSize: mod87Granule.granuleSize,
        producerGranuleId: mod87Granule.producerGranuleId,
      },
      {
        granuleId: `MOD09GQ.A2017224.h09v02.006.2017227165020_${result.granules[1].granuleId.split('_')[1]}`,
        granuleSize: 17909733,
        producerGranuleId: 'MOD09GQ.A2017224.h09v02.006.2017227165020',
      },
      'Duplicate granule colliding with MOD09GA but from mod87 should match expected values'
    );
  }
);

test.serial(
  'parse-pdr "uniquifies" granuleIds based on collectionId hash when includeTimestampHashKey is set to false',
  async (t) => {
    t.context.payload.input.pdr.name = 'multi-data-type.PDR';
    await setUpTestPdrAndValidate(t).catch(t.fail);
    const payload = structuredClone(t.context.payload);
    payload.config.uniquifyGranuleId = true;
    const result = await parsePdr(payload);
    await validateOutput(t, result).catch(t.fail);
    t.is(result.filesCount, 4);
    t.is(result.granulesCount, 2);
    t.is(result.granules.length, 2);
    t.is(result.totalSize, 35819466);
    // test MOD09 006
    const mod09Granule = result.granules.find((granule) => granule.dataType === 'MOD09GQ');
    t.truthy(mod09Granule);
    t.is(mod09Granule.granuleId, 'MOD09GQ.A2017224.h09v02.006.2017227165020_aoYA4tTn'); // includes added uniquified hash string
    // test MOD87 006
    const mod87Granule = result.granules.find((granule) => granule.dataType === 'MOD87GQ');
    t.truthy(mod87Granule);
    t.is(mod87Granule.granuleId, 'MOD87GQ.A2017224.h09v02.006.2017227165020_UR9rEmjv'); // includes added uniquified hash string
  }
);

test.serial(
  'parse-pdr "uniquifies" granuleIds based on collectionId + timestamp hash when includeTimestampHashKey is set to true',
  async (t) => {
    t.context.payload.input.pdr.name = 'multi-data-type.PDR';
    await setUpTestPdrAndValidate(t).catch(t.fail);
    const payload = structuredClone(t.context.payload);
    payload.config.uniquifyGranuleId = true;
    payload.config.includeTimestampHashKey = true;
    const result = await parsePdr(payload);
    await validateOutput(t, result).catch(t.fail);
    t.is(result.filesCount, 4);
    t.is(result.granulesCount, 2);
    t.is(result.granules.length, 2);
    t.is(result.totalSize, 35819466);
    // test MOD09 006
    const mod09Granule = result.granules.find((granule) => granule.dataType === 'MOD09GQ');
    const mod09GranuleSubstring = 'MOD09GQ';
    t.regex(mod09Granule.granuleId, new RegExp(`^${mod09GranuleSubstring}.A2017224.h09v02.006.2017227165020_[a-zA-Z0-9-]{8}$`));
    t.truthy(mod09Granule);

    const mod87Granule = result.granules.find((granule) => granule.dataType === 'MOD87GQ');
    const mod87GranuleSubstring = 'MOD87GQ';
    t.regex(mod87Granule.granuleId, new RegExp(`^${mod87GranuleSubstring}.A2017224.h09v02.006.2017227165020_[a-zA-Z0-9-]{8}$`));
    t.truthy(mod87Granule);
  }
);

test.serial(
  'parse-pdr throws an error on ingest when two cross-collection granules have the same granule ID and uniquifyGranuleId is set to false',
  async (t) => {
    t.context.payload.input.pdr.name = 'cross-collection-id-collision.PDR';
    await setUpTestPdrAndValidate(t).catch(t.fail);

    const payload = structuredClone(t.context.payload);
    await t.throwsAsync(parsePdr(payload),
      { message: /Duplicate granule ID found for/ });
  }
);
