const { sign: jwtSign } = require('jsonwebtoken');

const createJwtToken = ({ accessToken, expirationTime, username }) => {
  return jwtSign({
    exp: expirationTime,
    accessToken,
    username
  }, process.env.TOKEN_SECRET, {
    noTimestamp: true
  });
};

module.exports = {
  createJwtToken
};
