const test = require('ava');

const { isCollisionError } = require('../../dist/lib/errors');

test('isCollisionError returns true if error code maps to expected knex error.code', (t) => {
  t.true(isCollisionError({ code: '23505' }));
});

test('isCollisionError returns false if error code does not map to expected knex error.code', (t) => {
  t.false(isCollisionError({ code: '000' }));
});
