'use strict';

const test = require('ava');

const { isCatalogError } = require('../../dist/iceberg-search/DuckDBSearchExecutor');

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

test('isCatalogError returns false for non-Error values', (t) => {
  t.false(isCatalogError({ message: 'Catalog Error: Table with name granules does not exist!' }));
  t.false(isCatalogError(undefined));
});
