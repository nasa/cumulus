const { sign: jwtSign, verify: jwtVerify } = require('jsonwebtoken');

const createJwtToken = ({ accessToken, expirationTime, username }) => {
  // JWT expiration time is in seconds, not milliseconds
  expirationTime = Math.floor(expirationTime / 1000);
  return jwtSign({
    exp: expirationTime,
    accessToken,
    username
  }, process.env.TOKEN_SECRET, {
    noTimestamp: true
  });
};

const verifyJwtToken = (jwtToken, options = {}) => {
  return jwtVerify(jwtToken, process.env.TOKEN_SECRET, options);
}

module.exports = {
  createJwtToken,
  verifyJwtToken
};
