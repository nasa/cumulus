'use strict';

const got = require('got');

class TokenValidationError extends Error {
  constructor(code, message) {
    super(message);

    this.name = 'TokenValidationError';
    this.code = code;

    Error.captureStackTrace(this, TokenValidationError);
  }
}

const isHttpForbiddenResponse = ({ statusCode }) => statusCode === 403;

const handleForbiddenResponse = ({ body }) => {
  switch (body.error) {
  case 'invalid_token':
    throw new TokenValidationError('InvalidToken', 'Invalid token');
  case 'token_expired':
    throw new TokenValidationError('TokenExpired', 'The token has expired');
  default:
    throw new TokenValidationError('UnexpectedResponse', `Unexpected response: ${body}`);
  }
};

const sendGetTokenUsernameRequest = async ({
  earthdataLoginEndpoint,
  clientId,
  onBehalfOf,
  token
}) => {
  const requestOptions = {
    prefixUrl: earthdataLoginEndpoint,
    form: {
      client_id: clientId,
      on_behalf_of: onBehalfOf,
      token
    },
    responseType: 'json',
    throwHttpErrors: false
  };

  try {
    return await got.post('oauth/tokens/user', requestOptions);
  } catch (error) {
    if (error.name === 'ParseError') {
      throw new TokenValidationError(
        'InvalidResponse',
        'Response from Earthdata Login was not JSON'
      );
    }

    throw error;
  }
};

const getTokenUsername = async ({
  earthdataLoginEndpoint,
  clientId,
  onBehalfOf,
  token
}) => {
  const getTokenUserResponse = await sendGetTokenUsernameRequest({
    earthdataLoginEndpoint,
    clientId,
    onBehalfOf,
    token
  });

  if (isHttpForbiddenResponse(getTokenUserResponse)) {
    handleForbiddenResponse(getTokenUserResponse);
  }

  return getTokenUserResponse.body.uid;
};

module.exports = {
  getTokenUsername,
  TokenValidationError
};
