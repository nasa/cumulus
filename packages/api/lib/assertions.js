'use strict';

exports.isAuthorizationMissingResponse = (t, response) => {
  t.is(response.statusCode, 401);

  const responseBody = JSON.parse(response.body);
  t.is(responseBody.message, 'Authorization header missing');
};

exports.isInvalidAccessTokenResponse = (t, response) => {
  t.is(response.statusCode, 403);

  const responseBody = JSON.parse(response.body);
  t.is(responseBody.message, 'Invalid access token');
};

exports.isExpiredAccessTokenResponse = (t, response) => {
  t.is(response.statusCode, 403);

  t.is(response.headers['Content-Type'], 'application/json');

  const parsedResponseBody = JSON.parse(response.body);
  t.is(parsedResponseBody.message, 'Access token has expired');
};

exports.isUnauthorizedUserResponse = (t, response) => {
  t.is(response.statusCode, 403);

  const responseBody = JSON.parse(response.body);
  t.is(responseBody.message, 'User not authorized');
};

exports.isInvalidAuthorizationResponse = (t, response) => {
  t.is(response.statusCode, 401);
};
