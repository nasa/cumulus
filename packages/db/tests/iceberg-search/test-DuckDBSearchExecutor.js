'use strict';

const test = require('ava');

const { isCatalogError, isRecoverableS3HttpError } = require('../../dist/iceberg-search/DuckDBSearchExecutor');

test('isCatalogError returns true for DuckDB missing table catalog error', (t) => {
  const error = new Error('Catalog Error: Table with name granules does not exist!\nDid you mean "pg_tables"?');
  t.true(isCatalogError(error));
});

test('isCatalogError returns true when table name is quoted', (t) => {
  const error = new Error('Catalog Error: Table with name "granules" does not exist!');
  t.true(isCatalogError(error));
});

test('isCatalogError returns false for non-catalog error', (t) => {
  const error = new Error('Binder Error: Referenced column not found');
  t.false(isCatalogError(error));
});

test('isCatalogError returns true for Binder missing catalog error', (t) => {
  const error = new Error('Binder Error: Catalog "glue_iceberg" does not exist!');
  t.true(isCatalogError(error));
});

test('isCatalogError returns true for Binder missing catalog error with single quotes', (t) => {
  const error = new Error('Binder Error: Catalog \'glue_iceberg\' does not exist!');
  t.true(isCatalogError(error));
});

test('isCatalogError returns false for non-Error values', (t) => {
  t.false(isCatalogError({ message: 'Catalog Error: Table with name granules does not exist!' }));
  t.false(isCatalogError(undefined));
});

test('isRecoverableS3HttpError returns true for DuckDB S3 HTTP 400 GET error on valid extensions', (t) => {
  const errorParquet = new Error('HTTP Error: HTTP GET error on \'https://bucket.s3.us-east-1.amazonaws.com/file.parquet\' (HTTP 400)');
  const errorAvro = new Error('HTTP Error: HTTP GET error on \'https://bucket.s3.us-east-1.amazonaws.com/file.avro\' (HTTP 400)');
  const errorJson = new Error('HTTP Error: HTTP GET error on \'https://bucket.s3.us-east-1.amazonaws.com/file.json\' (HTTP 400)');

  t.true(isRecoverableS3HttpError(errorParquet));
  t.true(isRecoverableS3HttpError(errorAvro));
  t.true(isRecoverableS3HttpError(errorJson));
});

test('isRecoverableS3HttpError returns false when URL is not an allowed S3 extension type', (t) => {
  t.false(isRecoverableS3HttpError(new Error('HTTP Error: HTTP GET error on \'https://bucket.s3.us-east-1.amazonaws.com/file.csv\' (HTTP 400)')));
  t.false(isRecoverableS3HttpError(new Error('HTTP Error: HTTP GET error on \'https://example.com/file.parquet\' (HTTP 400)')));
});

test('isRecoverableS3HttpError returns false for non-recoverable errors', (t) => {
  t.false(isRecoverableS3HttpError(new Error('Binder Error: Referenced column not found')));
  t.false(isRecoverableS3HttpError(new Error('ExpiredToken: The provided token has expired')));
  t.false(isRecoverableS3HttpError(undefined));
});
