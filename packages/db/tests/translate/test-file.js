const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');

const { ValidationError } = require('@cumulus/errors');

const { translateApiFiletoPostgresFile } = require('../../dist/translate/file');

const fileOmitKeys = ['checksum', 'checksumType', 'fileName', 'size'];

test('translateApiFiletoPostgresFile converts API file to Postgres', (t) => {
  const file = {
    bucket: cryptoRandomString({ length: 3 }),
    key: cryptoRandomString({ length: 3 }),
    fileName: cryptoRandomString({ length: 3 }),
    checksumType: 'md5',
    checksum: 'bogus-value',
    size: 100,
    source: 'fake-source',
  };
  t.deepEqual(
    translateApiFiletoPostgresFile(file),
    omit(
      {
        ...file,
        checksum_type: file.checksumType,
        checksum_value: file.checksum,
        file_name: file.fileName,
        file_size: file.size,
        path: undefined,
      },
      fileOmitKeys
    )
  );
});

test('translateApiFiletoPostgresFile throws error if file bucket or key is missing', (t) => {
  const file = {
    bucket: undefined,
    key: undefined,
    fileName: cryptoRandomString({ length: 3 }),
    checksumType: 'md5',
    checksum: 'bogus-value',
    size: 100,
    source: 'fake-source',
  };

  t.throws(() => {
    translateApiFiletoPostgresFile(file);
  },
  {
    instanceOf: ValidationError,
    message: `bucket and key properties are required: ${JSON.stringify(file)}`,
  });
});
