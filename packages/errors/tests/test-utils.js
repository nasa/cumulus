'use strict';

const test = require('ava');
const isString = require('lodash/isString');
const { errorify } = require('../');

test('errorify serializes a normal error object', (t) => {
  const err = new Error('Something went wrong');
  err.name = 'ErrorName';
  const json = errorify(err);

  const parsed = JSON.parse(json);
  t.is(parsed.message, 'Something went wrong');
  t.true(isString(parsed.stack));
  t.is(parsed.name, 'ErrorName');
});

test('errorify removes circular references', (t) => {
  const err = new Error('Circular!');
  err.self = err; // Circular reference

  const json = errorify(err);
  const parsed = JSON.parse(json);

  t.is(parsed.message, 'Circular!');
  t.falsy(parsed.self); // should be undefined or removed
});

test('errorify includes own properties only', (t) => {
  const err = new Error('With code');
  err.code = 500;

  const json = errorify(err);
  const parsed = JSON.parse(json);

  t.is(parsed.code, 500);
  t.is(parsed.message, 'With code');
});

test('errorify handles nested circular references', (t) => {
  const err = new Error('Nested circular');
  const meta = { parent: err };
  err.meta = meta;

  const json = errorify(err);
  const parsed = JSON.parse(json);

  t.is(parsed.message, 'Nested circular');
  t.truthy(parsed.meta);
  t.is(parsed.meta.parent, undefined); // circular should be removed
});

