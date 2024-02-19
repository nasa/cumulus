const test = require('ava');

const { ValidationError } = require('@cumulus/errors');

const { isBadRequestError } = require('../../lib/errors');

test('isBadRequestError returns true for SchemaValidationError', (t) => {
  const error = new Error();
  error.name = 'SchemaValidationError';
  t.true(isBadRequestError(error));
});

test('isBadRequestError returns true when error.code has a "22" prefix', (t) => {
  const error = new Error();
  error.code = '220B5';
  t.true(isBadRequestError(error));
});

test('isBadRequestError returns true when error.code has a "23" prefix', (t) => {
  const error = new Error();
  error.code = '230B5';
  t.true(isBadRequestError(error));
});

test('isBadRequestError returns true for ValidationError', (t) => {
  t.true(isBadRequestError(new ValidationError()));
});

test('isBadRequestError returns false for generic error', (t) => {
  t.false(isBadRequestError(new Error()));
});

test('isBadRequestError returns true for knex ValidationException errors', (t) => {
  const error = new Error();
  error.name = 'ValidationException';
  t.true(isBadRequestError(error));
});
