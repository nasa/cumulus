'use strict';

exports.isAuthorizationMissingResponse = (t, response) => {
  t.is(response.statusCode, 401);

  const responseBody = JSON.parse(response.body);
  t.is(responseBody.message, 'Authorization header missing');
};
