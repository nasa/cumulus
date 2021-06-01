'use strict';

const test = require('ava');

const { convertTextField } = require('../textFields');

test('Given a field that has a keyword version, it returns the keyword version', (t) => {
  const field = 'granuleId';
  const result = convertTextField(field);

  t.is(result, `${field}.keyword`);
});

test('Given a field that has no keyword subfield, it returns the same field back', (t) => {
  const field = 'published';
  const result = convertTextField(field);

  t.is(result, field);
});
