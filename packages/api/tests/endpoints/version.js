'use strict';

const test = require('ava');
const versionEndpont = require('../../endpoints/version');
const pckg = require('../../package.json');

test('returns expected response', (t) => {
  const actualResponse = versionEndpont({});
  const expectedResponse = {
    body: {
      response_version: 'v1',
      api_version: pckg.version
    },
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Strict-Transport-Security': 'max-age=31536000'
    },
    statusCode: 200
  };

  t.deepEqual(actualResponse, expectedResponse);
});
