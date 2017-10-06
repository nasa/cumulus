'use strict';
const test = require('ava');
const filter = require('../index');

test('filter payload', t => {
  const payload = {
    a: 'A',
    b: 'B',
    c: 'C'
  };
  const outputKeys = ['a', 'c'];
  const outputPayload = filter.filterPayload(payload, outputKeys);
  t.is(outputPayload, { a: 'A', c: 'C' });
});
