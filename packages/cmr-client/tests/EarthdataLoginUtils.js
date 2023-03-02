const jwt = require('jsonwebtoken');
const { randomId } = require('@cumulus/common/test-utils');

const buildBasicAuthHeader = (username, password) => {
  const encodedCreds = Buffer.from(`${username}:${password}`).toString('base64');

  return `Basic ${encodedCreds}`;
};

const createToken = (params = {}) => {
  const expiration = Number(new Date().valueOf() + (60 * 120 * 1000));
  const expirationTime = params.expirationTime === undefined ? expiration : (params.expirationTime);
  const payload = {
    type: 'User',
    uid: randomId('uid-'),
    exp: expirationTime,
    ...params.payload,
  };

  return jwt.sign(
    payload,
    'test',
    {
      issuer: 'Earthdata Login',
    }
  );
};

const buildCreateTokenResponse = (token) => {
  const decodedToken = jwt.verify(token, 'test');
  if (decodedToken.exp === undefined) throw new Error('token exp is undefined');

  const expiration = new Date(decodedToken.exp * 1000);

  const expirationDate = expiration.toLocaleDateString('en', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  return {
    access_token: token,
    token_type: 'Bearer',
    expiration_date: expirationDate,
  };
};

const buildGetTokensResponse = (tokens) => tokens.map(
  (token) => {
    const decodedToken = jwt.verify(token, 'test');
    if (decodedToken.exp === undefined) throw new Error('token exp is undefined');

    const expiration = new Date(decodedToken.exp * 1000);

    const expirationDate = expiration.toLocaleDateString('en', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });

    return {
      access_token: token,
      expiration_date: expirationDate,
    };
  }
);

module.exports = {
  buildBasicAuthHeader,
  buildCreateTokenResponse,
  buildGetTokensResponse,
  createToken,
};
