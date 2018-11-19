const { sign: jwtSign, verify: jwtVerify } = require('jsonwebtoken');

const createJwtToken = ({ accessToken, expirationTime, username }) => {
  // JWT expiration time is in seconds, not milliseconds
  const exp = Math.floor(expirationTime / 1000);
  return jwtSign({
    exp,
    accessToken,
    username
  }, process.env.TOKEN_SECRET, {
    noTimestamp: true
  });
};

const verifyJwtToken = (jwtToken, params = {}) => {
  const options = Object.assign({
    algorithms: ['HS256']
  }, params);
  return jwtVerify(jwtToken, process.env.TOKEN_SECRET, options);
};

module.exports = {
  createJwtToken,
  verifyJwtToken
};
