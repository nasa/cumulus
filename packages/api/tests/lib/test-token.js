const test = require('ava');
const moment = require('moment');
const sinon = require('sinon');
const {
  JsonWebTokenError,
  TokenExpiredError,
} = require('jsonwebtoken');

const { RecordDoesNotExist } = require('@cumulus/errors');
const { TokenUnauthorizedUserError } = require('../../lib/errors');
const { fakeAccessTokenFactory } = require('../../lib/testUtils');
const {
  createJwtToken,
  verifyJwtToken,
  isAccessTokenExpired,
  getMaxSessionDuration,
  isSessionExpired,
  refreshTokenAndJwt,
  verifyAndDecodeTokenFromRequest,
  handleJwtVerificationError,
} = require('../../lib/token');

test.beforeEach(() => {
  process.env.TOKEN_SECRET = 'secret';
});

test.afterEach(() => {
  delete process.env.TOKEN_SECRET;
});

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

test('createJwtToken and verifyJwtToken work together', (t) => {
  const payload = { accessToken: 'abc', username: 'user', expirationTime: moment().unix() + 100 };
  const token = createJwtToken(payload);
  const decoded = verifyJwtToken(token);
  t.is(decoded.accessToken, 'abc');
  t.is(decoded.username, 'user');
});

test('createJwtToken accepts and uses the iat parameter', (t) => {
  const customIat = Math.floor(Date.now() / 1000) - 1000;
  const token = createJwtToken({
    accessToken: 'abc',
    expirationTime: moment().unix() + 100,
    username: 'user',
    iat: customIat,
  });
  const decoded = verifyJwtToken(token);
  t.is(decoded.iat, customIat);
});

test('getMaxSessionDuration returns default value', (t) => {
  const oldVal = process.env.MAX_SESSION_DURATION;
  delete process.env.MAX_SESSION_DURATION;
  t.is(getMaxSessionDuration(), 43200);
  process.env.MAX_SESSION_DURATION = oldVal;
});

test('getMaxSessionDuration returns custom value', (t) => {
  const oldVal = process.env.MAX_SESSION_DURATION;
  process.env.MAX_SESSION_DURATION = '3600';
  t.is(getMaxSessionDuration(), 3600);
  process.env.MAX_SESSION_DURATION = oldVal;
});

test('isSessionExpired returns true if session older than max duration', (t) => {
  const oldVal = process.env.MAX_SESSION_DURATION;
  process.env.MAX_SESSION_DURATION = '3600';
  const decodedToken = { iat: Math.floor(Date.now() / 1000) - 3601 };
  t.true(isSessionExpired(decodedToken));
  process.env.MAX_SESSION_DURATION = oldVal;
});

test('isSessionExpired returns false if session within max duration', (t) => {
  const oldVal = process.env.MAX_SESSION_DURATION;
  process.env.MAX_SESSION_DURATION = '3600';
  const decodedToken = { iat: Math.floor(Date.now() / 1000) - 3599 };
  t.false(isSessionExpired(decodedToken));
  process.env.MAX_SESSION_DURATION = oldVal;
});

test('handleJwtVerificationError handles TokenExpiredError', (t) => {
  const response = {
    boom: {
      unauthorized: sinon.stub().returns('unauthorized'),
    },
  };
  const err = new TokenExpiredError('expired', new Date());
  const result = handleJwtVerificationError(err, response);
  t.is(result, 'unauthorized');
  t.true(response.boom.unauthorized.calledWith('Access token has expired'));
});

test('handleJwtVerificationError handles JsonWebTokenError', (t) => {
  const response = {
    boom: {
      unauthorized: sinon.stub().returns('unauthorized'),
    },
  };
  const err = new JsonWebTokenError('invalid');
  const result = handleJwtVerificationError(err, response);
  t.is(result, 'unauthorized');
  t.true(response.boom.unauthorized.calledWith('Invalid access token'));
});

test('handleJwtVerificationError handles TokenUnauthorizedUserError', (t) => {
  const response = {
    boom: {
      unauthorized: sinon.stub().returns('unauthorized'),
    },
  };
  const err = new TokenUnauthorizedUserError('unauthorized');
  const result = handleJwtVerificationError(err, response);
  t.is(result, 'unauthorized');
  t.true(response.boom.unauthorized.calledWith('User not authorized'));
});

test('handleJwtVerificationError throws if error type unknown', (t) => {
  const response = {};
  const err = new Error('unknown');
  t.throws(() => handleJwtVerificationError(err, response));
});

test('verifyAndDecodeTokenFromRequest throws error if token is missing', (t) => {
  const request = { body: {} };
  const error = t.throws(() => verifyAndDecodeTokenFromRequest(request));
  t.true(error.noToken);
  t.is(error.message, 'Request requires a token');
});

test('verifyAndDecodeTokenFromRequest throws error if token is invalid', (t) => {
  const request = { body: { token: 'invalid-token' } };
  const error = t.throws(() => verifyAndDecodeTokenFromRequest(request));
  t.truthy(error.jwtError);
  t.true(error.message.includes('JWT verification failed'));
});

test('verifyAndDecodeTokenFromRequest throws error if session is expired', (t) => {
  const oldMaxDuration = process.env.MAX_SESSION_DURATION;
  process.env.MAX_SESSION_DURATION = '3600';
  const iat = Math.floor(Date.now() / 1000) - 4000;
  const token = createJwtToken({ accessToken: 'abc', username: 'user', expirationTime: moment().unix() + 100, iat });
  const request = { body: { token } };

  const error = t.throws(() => verifyAndDecodeTokenFromRequest(request));
  t.true(error.sessionExpired);
  t.is(error.message, 'Session has exceeded maximum duration');
  process.env.MAX_SESSION_DURATION = oldMaxDuration;
});

test('verifyAndDecodeTokenFromRequest returns decoded token if valid', (t) => {
  const iat = Math.floor(Date.now() / 1000) - 100;
  const token = createJwtToken({ accessToken: 'abc', username: 'user', expirationTime: moment().unix() + 100, iat });
  const request = { body: { token } };

  const decoded = verifyAndDecodeTokenFromRequest(request);
  t.is(decoded.accessToken, 'abc');
  t.is(decoded.username, 'user');
  t.is(decoded.iat, iat);
});

test('refreshTokenAndJwt throws TypeError if token record does not exist', async (t) => {
  const accessTokenModel = {
    get: sinon.stub().rejects(new RecordDoesNotExist()),
  };
  const decodedToken = { accessToken: 'missing', username: 'user', iat: 123 };
  await t.throwsAsync(() => refreshTokenAndJwt(decodedToken, accessTokenModel), {
    instanceOf: TypeError,
    message: 'Invalid access token',
  });
});

test('refreshTokenAndJwt refreshes token and returns new JWT', async (t) => {
  const accessToken = 'abc';
  const username = 'user';
  const iat = Math.floor(Date.now() / 1000) - 100;
  const initialExpiration = Math.floor(Date.now() / 1000) + 1000;
  const extensionSeconds = 3600;

  const accessTokenRecord = { accessToken, expirationTime: initialExpiration };
  const accessTokenModel = {
    get: sinon.stub().resolves(accessTokenRecord),
    update: sinon.stub().resolves(),
  };

  const decodedToken = { accessToken, username, iat };
  const jwtToken = await refreshTokenAndJwt(decodedToken, accessTokenModel, extensionSeconds);

  t.truthy(jwtToken);
  const decoded = verifyJwtToken(jwtToken);
  t.is(decoded.accessToken, accessToken);
  t.is(decoded.username, username);
  t.is(decoded.iat, iat);
  t.is(decoded.exp, initialExpiration + extensionSeconds);

  t.true(accessTokenModel.update.calledWith(
    { accessToken },
    { expirationTime: initialExpiration + extensionSeconds }
  ));
});

test('refreshTokenAndJwt uses current time as base if expirationTime is missing', async (t) => {
  const accessToken = 'abc';
  const username = 'user';
  const iat = Math.floor(Date.now() / 1000) - 100;
  const extensionSeconds = 3600;

  const accessTokenRecord = { accessToken }; // no expirationTime
  const accessTokenModel = {
    get: sinon.stub().resolves(accessTokenRecord),
    update: sinon.stub().resolves(),
  };

  const now = Math.floor(Date.now() / 1000);
  const decodedToken = { accessToken, username, iat };
  const jwtToken = await refreshTokenAndJwt(decodedToken, accessTokenModel, extensionSeconds);

  const decoded = verifyJwtToken(jwtToken);
  // Should be close to now + extensionSeconds
  t.true(decoded.exp >= now + extensionSeconds);
  t.true(decoded.exp <= now + extensionSeconds + 2);
});
