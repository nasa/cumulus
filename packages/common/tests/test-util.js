const test = require('ava');
const isNil = require('lodash/isNil');
const { omitDeepBy, parseIfJson } = require('../util');

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

test('parseIfJson correctly parses strings into objects/arrays or returns the original value', (t) => {
  // Parsed Cases (Objects/Arrays)
  t.deepEqual(parseIfJson('{"a":1}'), { a: 1 }, 'should parse JSON objects');
  t.deepEqual(parseIfJson('[1, 2]'), [1, 2], 'should parse JSON arrays');

  // Strict/Bypass Cases (Primitives/Non-strings)
  t.is(parseIfJson('123'), '123', 'should return numeric strings as-is');
  t.is(parseIfJson(true), true, 'should return boolean types as-is');
  t.is(parseIfJson(null), null, 'should return null as-is');

  // Error Case
  t.is(parseIfJson('{"bad":'), '{"bad":', 'should return malformed JSON strings as-is');
});
