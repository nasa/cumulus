'use strict';

const test = require('ava');
const { isCumulusMessageLike } = require('../CumulusMessage');

test('isCumulusMessageLike correctly filters for bare cumulus message shape', (t) => {
  t.false(isCumulusMessageLike('a')); // must be an object
  t.false(isCumulusMessageLike(3)); // must be an object
  t.false(isCumulusMessageLike({ a: 'b' })); // must contain cumulus_meta attribute
  t.true(isCumulusMessageLike({ cumulus_meta: 'a' })); // checks for nothing more than this content
});
