'use strict';

exports.isAuthorizationMissingResponse = (t, response) => {
  t.is(response.status, 401);
  t.is(response.body.message, 'Authorization header missing');
};

exports.isInvalidAccessTokenResponse = (t, response) => {
  t.is(response.status, 403);
  t.is(response.body.message, 'Invalid access token');
};

exports.isExpiredAccessTokenResponse = (t, response) => {
  t.is(response.statusCode, 403);

  t.is(response.headers['Content-Type'], 'application/json');

  const parsedResponseBody = JSON.parse(response.body);
  t.is(parsedResponseBody.message, 'Access token has expired');
};

exports.isUnauthorizedUserResponse = (t, response) => {
  t.is(response.status, 401);
  t.is(response.body.message, 'User not authorized');
};

exports.isInvalidAuthorizationResponse = (t, response) => {
  t.is(response.status, 401);
};
