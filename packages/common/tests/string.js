'use strict';

const test = require('ava');
const { translateCamelCaseColumnName, translateSnakeCaseColumnName } = require('../string');

test('translateCamelCaseColumnName translates the column name', (t) => {
  const actual = translateCamelCaseColumnName('testColumnName');
  t.is('test_column_name', actual);
});

test('translateCamelCaseColumnName ignores single word columns', (t) => {
  const actual = translateCamelCaseColumnName('test');
  t.is('test', actual);
});

test('translateSnakeCaseColumnName translates the column name', (t) => {
  const actual = translateSnakeCaseColumnName('test_column_name');
  t.is('testColumnName', actual);
});

test('translateSnakeCaseColumnName handles dunder properly', (t) => {
  const actual = translateSnakeCaseColumnName('test__column_name');
  t.is('testColumnName', actual);
});

test('translateCamelCaseColumnName ignores single word columns', (t) => {
  const actual = translateSnakeCaseColumnName('test');
  t.is('test', actual);
});
