'use strict';

exports.isAuthorizationMissingResponse = (t, response) => {
  t.is(response.statusCode, 401);

  const responseBody = JSON.parse(response.body);
  t.is(responseBody.message, 'Authorization header missing');
};

exports.isUnauthorizedUserResponse = (t, response) => {
  t.is(response.statusCode, 403);

  const responseBody = JSON.parse(response.body);
  t.is(responseBody.message, 'User not authorized');
};
