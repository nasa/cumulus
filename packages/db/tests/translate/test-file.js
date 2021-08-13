const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');

const {
  translateApiFiletoPostgresFile,
  translatePostgresFileToApiFile,
} = require('../../dist/translate/file');

const apiFileOmitKeys = ['checksum', 'checksumType', 'fileName', 'size', 'filename'];
const postgresFileOmitKeys = ['checksum_type', 'checksum_value', 'file_name', 'file_size'];

test('translatePgFileToApiFile converts Postgres file to API file', (t) => {
  const postgresFile = {
    bucket: 'cumulus-test-sandbox-private',
    key: 'firstKey',
    file_name: 's3://cumulus-test-sandbox-private/firstKey',
    checksum_type: 'md5',
    checksum_value: 'bogus-value',
    file_size: '100',
    path: 's3://cumulus-test-sandbox-private/sourceDir/firstKey',
    source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
  };

  t.deepEqual(
    translatePostgresFileToApiFile(postgresFile),
    omit(
      {
        ...postgresFile,
        bucket: postgresFile.bucket,
        key: postgresFile.key,
        checksumType: postgresFile.checksum_type,
        checksum: postgresFile.checksum_value,
        fileName: postgresFile.file_name,
        size: Number.parseInt(postgresFile.file_size, 10),
        path: postgresFile.path,
        source: postgresFile.source,
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
      },
      apiFileOmitKeys
    )
  );
});

test('translateApiFiletoPostgresFile gets a bucket and key from filename', (t) => {
  const apiFile = {
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
    translateApiFiletoPostgresFile(apiFile),
    omit(
      {
        ...apiFile,
        bucket: 'cumulus-test-sandbox-private',
        key: 'somekey',
        checksum_type: apiFile.checksumType,
        checksum_value: apiFile.checksum,
        file_name: apiFile.fileName,
        file_size: apiFile.size,
        path: undefined,
      },
      apiFileOmitKeys
    )
  );
});
