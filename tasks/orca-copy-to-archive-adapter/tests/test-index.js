const test = require('ava');
const proxyquire = require('proxyquire');

const { randomId } = require('@cumulus/common/test-utils');

const fakeGranule = {
  granuleId: randomId('FakeGranule1'),
  dataType: randomId('FakeGranuleType'),
  version: '000',
  provider: randomId('FakeProvider'),
  createdAt: new Date().getTime(),
  files: [
    {
      bucket: randomId('fakeBucket1'),
      checksumType: 'md5',
      checksum: randomId('fakehash'),
      key: 'path/to/granule1/foo.jpg',
    },
    {
      bucket: randomId('fakeBucket1'),
      checksumType: 'md5',
      checksum: randomId('fakehash'),
      key: '/path/to/granule1/foo.dat',
    },
  ],
};

const fakeConfig = {
  providerId: randomId('fakeProviderId'),
  executionId: randomId('fakeExecutionId'),
  collectionShortname: randomId('fakecollectionShortname'),
  collectionVersion: randomId('fakecollectionVersion'),
};

const fakeOutput = {
  granules: [fakeGranule],
  copied_to_orca: ['file1', 'file2'],
};

const fakeFailedLambdaName = randomId('fakeFailedLambdaName');
const fakeLambdaResponse = {
  StatusCode: 200,
  Payload: new TextEncoder().encode(JSON.stringify(fakeOutput)),
};

const fakeInvalidLambdaName = randomId('fakeInvalidLambdaName');
const fakeFailedInvokeResponse = {
  StatusCode: 500,
  Payload: new TextEncoder().encode(JSON.stringify(new Error('invoke error'))),
};

const {
  invokeOrcaCopyToArchive,
} = proxyquire('../dist/src', {
  '@cumulus/aws-client/Lambda': {
    invoke: (name) => {
      if (name === fakeFailedLambdaName) {
        throw new Error('copy to archive failed');
      }
      if (name === fakeInvalidLambdaName) {
        return Promise.resolve(fakeFailedInvokeResponse);
      }
      return Promise.resolve(fakeLambdaResponse);
    },
  },
});

const fakePayload = {
  input: {
    granules: [fakeGranule],
  },
  config: fakeConfig,
};

test.serial('invokeOrcaCopyToArchive() successfully invokes orca lambda', async (t) => {
  process.env.orca_lambda_copy_to_archive_arn = randomId('copy_to_archive_arn');
  const result = await invokeOrcaCopyToArchive(fakePayload);
  t.deepEqual(result, JSON.parse(new TextDecoder('utf-8').decode(fakeLambdaResponse.Payload)));
});

test.serial('invokeOrcaCopyToArchive() throws error if orca lambda failed', async (t) => {
  process.env.orca_lambda_copy_to_archive_arn = fakeFailedLambdaName;
  await t.throwsAsync(
    invokeOrcaCopyToArchive(fakePayload),
    {
      message: 'copy to archive failed',
    }
  );
});

test.serial('invokeOrcaCopyToArchive() throws error if lambda invocation failed', async (t) => {
  process.env.orca_lambda_copy_to_archive_arn = fakeInvalidLambdaName;
  await t.throwsAsync(
    invokeOrcaCopyToArchive(fakePayload),
    {
      message: /Failed to invoke orca lambda/,
    }
  );
});

test.serial('invokeOrcaCopyToArchive() throws error if env orca_lambda_copy_to_archive_arn is not set', async (t) => {
  delete process.env.orca_lambda_copy_to_archive_arn;
  await t.throwsAsync(
    invokeOrcaCopyToArchive(fakePayload, undefined),
    {
      message: 'Environment orca_lambda_copy_to_archive_arn is not set',
    }
  );
});
