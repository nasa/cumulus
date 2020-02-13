const { sign: jwtSign, verify: jwtVerify } = require('jsonwebtoken');

const createJwtToken = ({ accessToken, expirationTime, username }) => {
  // JWT expiration time is in seconds, not milliseconds
  const exp = Math.floor(expirationTime / 1000);
  return jwtSign({
    exp,
    accessToken,
    username
  }, process.env.TOKEN_SECRET, {
    algorithm: 'HS256',
    noTimestamp: true
  });
};

const verifyJwtToken = (jwtToken, params = {}) => {
  const options = { algorithms: ['HS256'], ...params };
  return jwtVerify(jwtToken, process.env.TOKEN_SECRET, options);
};

module.exports = {
  createJwtToken,
  verifyJwtToken
};
