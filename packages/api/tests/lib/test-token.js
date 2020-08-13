const test = require('ava');
const moment = require('moment');

const { fakeAccessTokenFactory } = require('../../lib/testUtils');
const { isAccessTokenExpired } = require('../../lib/token');

test('isAccessTokenExpired returns true for expired token', (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: moment().unix(),
  });
  t.true(isAccessTokenExpired(accessTokenRecord));
});

test('isAccessTokenExpired returns false for non-expired token', (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: moment().unix() + 5,
  });
  t.false(isAccessTokenExpired(accessTokenRecord));
});

test('isAccessTokenExpired returns false for expirationTime with millisecond precision', (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: Date.now(),
  });
  t.false(isAccessTokenExpired(accessTokenRecord));
});
