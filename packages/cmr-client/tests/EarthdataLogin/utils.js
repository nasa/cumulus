// @ts-check

const jose = require('jose');
const { randomId } = require('@cumulus/common/test-utils');

const buildBasicAuthHeader = (username, password) => {
  const encodedCreds = Buffer.from(`${username}:${password}`).toString('base64');

  return `Basic ${encodedCreds}`;
};

const createToken = (params = {}) => {
  const payload = {
    type: 'User',
    uid: randomId('uid-'),
    ...params.payload,
  };

  const expirationTime = params.expirationTime === undefined ? '2h' : params.expirationTime;

  return new jose.UnsecuredJWT(payload)
    .setIssuer('Earthdata Login')
    .setIssuedAt()
    .setExpirationTime(expirationTime)
    .encode();
};

const buildCreateTokenResponse = (token) => {
  const decodedToken = jose.UnsecuredJWT.decode(token);
  if (decodedToken.payload.exp === undefined) throw new Error('token exp is undefined');

  const expiration = new Date(decodedToken.payload.exp * 1000);

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
    const decodedToken = jose.UnsecuredJWT.decode(token);
    if (decodedToken.payload.exp === undefined) throw new Error('token exp is undefined');

    const expiration = new Date(decodedToken.payload.exp * 1000);

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
