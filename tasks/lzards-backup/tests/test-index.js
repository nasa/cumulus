const test = require('ava');
const sandbox = require('sinon').createSandbox();
const proxyquire = require('proxyquire');

const fakePostReturn = {
  body: 'fake body',
  statusCode: 201,
};
const fakeCollection = {
  files: [
    {
      regex: 'foo.jpg',
      backup: true,
    },
    {
      regex: 'foo.dat',
      backup: false,
    },
  ],
};
const getCollectionsStub = sandbox.stub().returns({
  body: JSON.stringify({
    results: [
      fakeCollection,
    ],
  }),
});
const gotPostStub = sandbox.stub().returns(fakePostReturn);
// eslint-disable-next-line unicorn/import-index
const index = proxyquire('../dist/src/index.js', {
  '@cumulus/api-client/collections': {
    getCollections: getCollectionsStub,
  },
  got: {
    default: {
      post: gotPostStub,
    },
  },
});
const env = { ...process.env };
test.beforeEach(() => {
  sandbox.restore();
  process.env = { ...env };
});

test('shouldBackupFile returns true if the regex matches and the backup option is set on the collectionFile', async (t) => {
  const mockedCollectionConfig = {
    files: [
      {
        regex: '^foo.jpg$',
        backup: true,
      },
      {
        regex: '^foo.md5$',
        backup: false,
      },
    ],
  };
  t.true(index.shouldBackupFile('foo.jpg', mockedCollectionConfig));
});

test('shouldBackupFile returns false if the regex matches and the backup option is not set on the collectionFile', async (t) => {
  const mockedCollectionConfig = {
    files: [
      {
        regex: '^foo.jpg$',
        backup: false,
      },
    ],
  };
  t.false(index.shouldBackupFile('foo.jpg', mockedCollectionConfig));
});

test('shouldBackupFile returns false if the regex matches and the backup option is set false on Collection File', async (t) => {
  const mockedCollectionConfig = {
    files: [
      {
        regex: '^foo.md5$',
        backup: true,
      },
    ],
  };
  t.false(index.shouldBackupFile('foo.jpg', mockedCollectionConfig));
});

test('shouldBackupFile returns false if there is no collection file defined', async (t) => {
  const mockedCollectionConfig = {};
  t.false(index.shouldBackupFile('foo.jpg', mockedCollectionConfig));
});

test.serial('makeBackupFileRequest returns the expected object', async (t) => {
  const accessUrl = 'https://www.nasa.gov';
  const accessUrlStub = sandbox.stub(index, 'generateAccessUrl').returns(accessUrl);
  const postStub = sandbox.stub(index, 'postRequestToLzards').returns({
    body: 'fake body',
    statusCode: 201,
  });
  const creds = { fake: 'creds_object' };
  const name = 'fakeFilename';
  const filepath = 'fakeFilePath';
  const authToken = 'fakeToken';
  const collection = 'FAKE_COLLECTION';
  const bucket = 'fakeFileBucket';

  const file = {
    name,
    filepath,
    bucket,
  };
  const granuleId = 'fakeGranuleId';

  const actual = await index.makeBackupFileRequest({
    authToken,
    collection,
    creds,
    file,
    granuleId,
  });

  const expected = {
    body: 'fake body',
    filename: 'fakeFilename',
    granuleId: 'fakeGranuleId',
    statusCode: 201,
  };

  t.deepEqual(accessUrlStub.getCalls()[0].args, [{ creds, Key: filepath, Bucket: bucket }]);
  t.deepEqual(postStub.getCalls()[0].args, [{
    accessUrl, authToken, collection, file, granuleId,
  }]);

  t.deepEqual(actual, expected);
});

test('getGranuleCollection returns queried collections', async (t) => {
  const collectionName = 'fakeCollection';
  const collectionVersion = '001';
  const stackPrefix = 'fakePrefix';
  const actual = await index.getGranuleCollection({
    collectionName,
    collectionVersion,
    stackPrefix,
  });
  t.deepEqual(actual, fakeCollection);
});

test('getGranuleCollection throws error if no prefix is set', async (t) => {
  const collectionName = 'fakeCollection';
  const collectionVersion = '001';
  await t.throwsAsync(index.getGranuleCollection({
    collectionName,
    collectionVersion,
  }));
});

test.serial('postRequestToLzards creates the expected query', async (t) => {
  const accessUrl = 'fakeUrl';
  const authToken = 'fakeToken';
  const collection = 'fakeCollectionString';
  const file = { fake: 'fileObject', filename: 'fakeFilename', checksum: 'fakeChecksum' };
  const granuleId = 'fakeGranuleId';
  const lzardsApi = 'fakeApi';
  const lzardsProviderName = 'fakeProvider';

  process.env.provider = lzardsProviderName;
  process.env.lzards_api = lzardsApi;

  const actual = await index.postRequestToLzards({
    accessUrl,
    authToken,
    collection,
    file,
    granuleId,
    lzardsApi,
    lzardsProviderName,
  });

  t.is(actual, fakePostReturn);
  t.deepEqual(gotPostStub.getCalls()[0].args, [lzardsApi, {
    json: {
      provider: lzardsProviderName,
      objectUrl: accessUrl,
      expectedMd5Hash: file.checksum,
      metadata: {
        filename: file.filename,
        collection,
        granuleId,
      },
    },
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  }]);
});

test.serial('postRequestToLzards throws if lzardsApiUrl is not set ', async (t) => {
  const accessUrl = 'fakeUrl';
  const authToken = 'fakeToken';
  const collection = 'fakeCollectionString';
  const file = { fake: 'fileObject', filename: 'fakeFilename', checksum: 'fakeChecksum' };
  const granuleId = 'fakeGranuleId';
  const lzardsProviderName = 'fakeProvider';

  process.env.provider = lzardsProviderName;
  await t.throwsAsync(index.postRequestToLzards({
    accessUrl,
    authToken,
    collection,
    file,
    granuleId,
  }));
});

test.serial('postRequestToLzards throws if provider is not set ', async (t) => {
  const accessUrl = 'fakeUrl';
  const authToken = 'fakeToken';
  const collection = 'fakeCollectionString';
  const file = { fake: 'fileObject', filename: 'fakeFilename', checksum: 'fakeChecksum' };
  const granuleId = 'fakeGranuleId';

  process.env.lzards_api = 'fakeApi';
  await t.throwsAsync(index.postRequestToLzards({
    accessUrl,
    authToken,
    collection,
    file,
    granuleId,
  }));
});

test('generateAccessUrl generates an v4 accessURL', async (t) => {
  const actual = await index.generateAccessUrl({
    Bucket: 'foo',
    Key: 'bar',
  });
  t.regex(actual, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
});

test('generateAccessUrl generates a credential using passed credentials', async (t) => {
  const actual = await index.generateAccessUrl({
    usePassedCredentials: true,
    creds: {
      Credentials: {
        SecretAccessKey: 'FAKEKey',
        AccessKeyId: 'FAKEId',
        SessionToken: 'FAKEToken',
      },
    },
    Bucket: 'foo',
    Key: 'bar',
  });
  t.regex(actual, /X-Amz-Credential=FAKEId/);
});

test('backupLzards Files', async (t) => {
  const actual = await index.generateAccessUrl({
    usePassedCredentials: true,
    creds: {
      Credentials: {
        SecretAccessKey: 'FAKEKey',
        AccessKeyId: 'FAKEId',
        SessionToken: 'FAKEToken',
      },
    },
    Bucket: 'foo',
    Key: 'bar',
  });
  t.regex(actual, /X-Amz-Credential=FAKEId/);
});

test.serial('backupGranulesToLzards returns the expected payload', async (t) => {
  sandbox.stub(index, 'generateAccessCredentials').returns({
    Credentials: {
      SecretAccessKey: 'FAKEKey',
      AccessKeyId: 'FAKEId',
      SessionToken: 'FAKEToken',
    },
  });
  sandbox.stub(index, 'getAuthToken').returns('fakeAuthToken');
  const fakePayload = {
    input: {
      granules: [
        {
          granuleId: 'FakeGranule1',
          dataType: 'FakeGranuelType',
          Version: '000',
          files: [
            {
              bucket: 'fakeBucket1',
              name: 'foo.jpg',
              filepath: '/path/to/granule1/foo.jpg',
              checksumType: 'md5',
              checksum: 'fakehash',
            },
            {
              bucket: 'fakeBucket2',
              name: 'foo.dat',
              filepath: '/path/to/granule1/foo.dat',
              checksumType: 'md5',
              checksum: 'fakehash',
            },
          ],
        },
        {
          granuleId: 'FakeGranule2',
          dataType: 'FakeGranuelType',
          Version: '000',
          files: [
            {
              bucket: 'fakeBucket1',
              name: 'foo.jpg',
              filepath: '/path/to/granule1/foo.jpg',
              checksumType: 'md5',
              checksum: 'fakehash',
            },
            {
              bucket: 'fakeBucket2',
              name: 'foo.dat',
              filepath: '/path/to/granule1/foo.dat',
              checksumType: 'md5',
              checksum: 'fakehash',
            },
          ],
        },
      ],
    },
  };

  process.env.lzards_api = 'fakeApi';
  process.env.provider = 'fakeProvider';
  process.env.stackName = 'fakeStack';

  const actual = await index.handler(fakePayload);
  const expected = [
    {
      body: 'fake body',
      filename: 'foo.jpg',
      granuleId: 'FakeGranule1',
      statusCode: 201,
    },
    {
      body: 'fake body',
      filename: 'foo.jpg',
      granuleId: 'FakeGranule2',
      statusCode: 201,
    },
  ];
  t.deepEqual(actual, expected);
});
