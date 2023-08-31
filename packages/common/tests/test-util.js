const test = require('ava');
const isNil = require('lodash/isNil');
const { omitDeepBy } = require('../util');

test('omitDeepBy returns new object when properties recursively removed based on predictate function', (t) => {
  const original = {
    a: 'a',
    b: null,
    c: {
      b: 'b',
      d: {
        b: 'b',
        f: null,
      },
      g: ['h', 'i', null],
    },
  };
  const expected = {
    a: 'a',
    c: {
      b: 'b',
      d: {
        b: 'b',
      },
      g: ['h', 'i', null],
    },
  };
  const result = omitDeepBy(original, isNil);
  t.deepEqual(result, expected);
});
