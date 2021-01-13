const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');

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
