const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');

const {
  translateApiFiletoPostgresFile,
  translatePostgresFileToApiFile,
} = require('../../dist/translate/file');

const fileOmitKeys = ['checksum', 'checksumType', 'fileName', 'size', 'filename'];
const postgresFileOmitKeys = ['checksum_type', 'checksum_value', 'file_name', 'file_size', 'created_at', 'updated_at'];

test('translatePgFileToApiFile converts Postgres file to API file', (t) => {
  const postgresFile = {
    bucket: 'cumulus-test-sandbox-private',
    checksum_type: 'md5',
    checksum_value: 'bogus-value',
    file_name: 's3://cumulus-test-sandbox-private/firstKey',
    file_size: '100',
    key: 'firstKey',
    source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
    created_at: new Date(Date.now()),
    updated_at: new Date(Date.now()),
  };

  t.deepEqual(
    translatePostgresFileToApiFile(postgresFile),
    omit(
      {
        ...postgresFile,
        bucket: postgresFile.bucket,
        checksum: postgresFile.checksum_value,
        checksumType: postgresFile.checksum_type,
        fileName: postgresFile.file_name,
        key: postgresFile.key,
        size: postgresFile.file_size,
        source: postgresFile.source,
      },
      postgresFileOmitKeys
    )
  );
});

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
      },
      fileOmitKeys
    )
  );
});
