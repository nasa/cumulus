const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');

const {
  translateApiFiletoPostgresFile,
  translatePostgresFileToApiFile,
} = require('../../dist/translate/file');

const apiFileOmitKeys = ['checksum', 'checksumType', 'fileName', 'size', 'filename'];
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
    type: 'data',
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
        size: Number.parseInt(postgresFile.file_size, 10),
        source: postgresFile.source,
        type: postgresFile.type,
      },
      postgresFileOmitKeys
    )
  );
});

test('translateApiFiletoPostgresFile converts API file to Postgres', (t) => {
  const apiFile = {
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
    translateApiFiletoPostgresFile(apiFile),
    omit(
      {
        ...apiFile,
        checksum_type: apiFile.checksumType,
        checksum_value: apiFile.checksum,
        file_name: apiFile.fileName,
        file_size: apiFile.size,
        path: undefined,
        type: 'data',
      },
      apiFileOmitKeys
    )
  );
});

test('translateApiFiletoPostgresFile gets a bucket and key from filename', (t) => {
  const apiFile = {
    bucket: undefined,
    checksum: 'bogus-value',
    checksumType: 'md5',
    filename: 's3://cumulus-test-sandbox-private/somekey',
    fileName: cryptoRandomString({ length: 3 }),
    key: undefined,
    size: 100,
    source: 'fake-source',
  };
  t.deepEqual(
    translateApiFiletoPostgresFile(apiFile),
    omit(
      {
        ...apiFile,
        bucket: 'cumulus-test-sandbox-private',
        checksum_type: apiFile.checksumType,
        checksum_value: apiFile.checksum,
        file_name: apiFile.fileName,
        file_size: apiFile.size,
        key: 'somekey',
        path: undefined,
        type: undefined,
      },
      apiFileOmitKeys
    )
  );
});
