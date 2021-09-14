const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');

const { translateApiFiletoPostgresFile } = require('../../dist/translate/file');

const fileOmitKeys = ['checksum', 'checksumType', 'fileName', 'size', 'filename'];

test('translateApiFiletoPostgresFile converts API file to Postgres', (t) => {
  const file = {
    bucket: cryptoRandomString({ length: 3 }),
    key: cryptoRandomString({ length: 3 }),
    fileName: cryptoRandomString({ length: 3 }),
    checksumType: 'md5',
    checksum: 'bogus-value',
    size: 100,
    source: 'fake-source',
    type: 'data',
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
        type: 'data',
      },
      fileOmitKeys
    )
  );
});

test('translateApiFiletoPostgresFile gets a bucket and key from filename', (t) => {
  const file = {
    bucket: undefined,
    key: undefined,
    fileName: cryptoRandomString({ length: 3 }),
    filename: 's3://cumulus-test-sandbox-private/somekey',
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
        bucket: 'cumulus-test-sandbox-private',
        key: 'somekey',
        checksum_type: file.checksumType,
        checksum_value: file.checksum,
        file_name: file.fileName,
        file_size: file.size,
        path: undefined,
        type: undefined,
      },
      fileOmitKeys
    )
  );
});
