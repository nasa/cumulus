const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const proxyquire = require('proxyquire');

const randomString = () => cryptoRandomString({ length: 10 });

const fakeGranule = {
  granuleId: 'FakeGranule1',
  dataType: 'FakeGranuleType',
  version: '000',
  provider: 'FakeProvider',
  createdAt: new Date().getTime(),
  files: [
    {
      bucket: 'fakeBucket1',
      checksumType: 'md5',
      checksum: 'fakehash',
      key: 'path/to/granule1/foo.jpg',
    },
    {
      bucket: 'fakeBucket1',
      checksumType: 'md5',
      checksum: 'fakehash',
      key: '/path/to/granule1/foo.dat',
    },
  ],
};

const fakeConfig = {
  providerId: 'fakeProviderId',
  executionId: 'fakeExecutionId',
  collectionShortname: 'fakecollectionShortname',
  collectionVersion: 'fakecollectionVersion',
};

const fakeOutput = {
  granules: [fakeGranule],
  copied_to_orca: ['file1', 'file2'],
};

const fakeLambdaResponse = {
  StatusCode: 200,
  Payload: JSON.stringify(fakeOutput),
};

const fakeFailedLambdaName = 'fakeFailedLambdaName';
const {
  invokeOrcaCopyToArchive,
} = proxyquire('../dist/src', {
  '@cumulus/aws-client/Lambda': {
    invoke: (name) => {
      if (name === fakeFailedLambdaName) {
        throw new Error('copy to archive failed');
      }
      return Promise.resolve(fakeLambdaResponse);
    },
  },
});

test.serial('invokeOrcaCopyToArchive() successfully invokes orca lambda', async (t) => {
  process.env.orca_lambda_copy_to_archive_arn = randomString();
  const fakePayload = {
    input: {
      granules: [fakeGranule],
    },
    config: fakeConfig,
  };
  const result = await invokeOrcaCopyToArchive(fakePayload);
  t.deepEqual(result, JSON.parse(fakeLambdaResponse.Payload));
});

test.serial('invokeOrcaCopyToArchive() throws error if orca lambda failed', async (t) => {
  process.env.orca_lambda_copy_to_archive_arn = fakeFailedLambdaName;
  const fakePayload = {
    input: {
      granules: [fakeGranule],
    },
    config: fakeConfig,
    fail: true,
  };
  await t.throwsAsync(
    invokeOrcaCopyToArchive(fakePayload),
    {
      message: 'copy to archive failed',
    }
  );
});
