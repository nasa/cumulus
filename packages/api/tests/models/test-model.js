'use strict';

const test = require('ava');
const Model = require('../../models/modelBase');

const model = new Model;

test('translateItemToSnakeCase translates a database item', (t) => {
  const originalItem = { aTestItem: 'testing', anotherTestItem: 'testing' };
  const expected = { a_test_item: 'testing', another_test_item: 'testing' };
  const actual = model.translateItemToSnakeCase(originalItem);
  t.deepEqual(expected, actual);
});

test('translateItemToCamelCase translates a database item', (t) => {
  const expected = { aTestItem: 'testing', anotherTestItem: 'testing' };
  const originalItem = { a_test_item: 'testing', another_test_item: 'testing' };
  const actual = model.translateItemToCamelCase(originalItem);
  t.deepEqual(expected, actual);
});
