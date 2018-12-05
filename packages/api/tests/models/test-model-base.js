'use strict';

const test = require('ava');
const Model = require('../../models/modelBase');

const model = new Model;

test('translateCamelCaseColumnName translates the column name', (t) => {
  const actual = model.translateCamelCaseColumnName('testColumnName');
  t.is('test_column_name', actual);
});

test('translateCamelCaseColumnName ignores single word columns', (t) => {
  const actual = model.translateCamelCaseColumnName('test');
  t.is('test', actual);
});

test('translateSnakeCaseColumnName translates the column name', (t) => {
  const actual = model.translateSnakeCaseColumnName('test_column_name');
  t.is('testColumnName', actual);
});

test('translateSnakeCaseColumnName handles dunder properly', (t) => {
  const actual = model.translateSnakeCaseColumnName('test__column_name');
  t.is('testColumnName', actual);
});


test('translateCamelCaseColumnName ignores single word columns', (t) => {
  const actual = model.translateSnakeCaseColumnName('test');
  t.is('test', actual);
});

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
