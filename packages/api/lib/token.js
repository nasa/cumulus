const { sign: jwtSign, verify: jwtVerify } = require('jsonwebtoken');

const createJwtToken = ({ accessToken, expirationTime, username }) =>
  jwtSign({
    exp: expirationTime,
    accessToken,
    username
  }, process.env.TOKEN_SECRET, {
    algorithm: 'HS256',
    noTimestamp: true
  });

const verifyJwtToken = (jwtToken, params = {}) => {
  const options = { algorithms: ['HS256'], ...params };
  return jwtVerify(jwtToken, process.env.TOKEN_SECRET, options);
};

module.exports = {
  createJwtToken,
  verifyJwtToken
};
