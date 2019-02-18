'use strict';

const test = require('ava');
const { isValidHostname } = require('../string');

test('isValidHostname() properly validates hostnames', (t) => {
  t.true(isValidHostname('asdf'));
  t.true(isValidHostname('example.com'));
  t.true(isValidHostname('a1.sauce'));
  t.true(isValidHostname('allow-dashes.com'));

  t.false(isValidHostname(''));
  t.false(isValidHostname('.com'));
  t.false(isValidHostname('-minus.com'));
  t.false(isValidHostname('no-$pecial-characters.com'));
  t.false(isValidHostname('http://with-schema.com'));
  t.false(isValidHostname('no spaces'));
});
