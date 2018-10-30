'use strict';

const test = require('ava');
const versionEndpont = require('../../endpoints/version');
const { LambdaProxyResponse } = require('../../lib/responses');
const pckg = require('../../package.json');

test('returns expected response', (t) => {
  const actualResponse = versionEndpont({});
  const expectedResponse = new LambdaProxyResponse({
    body: {
      response_version: 'v1',
      api_version: pckg.version
    }
  });
  t.deepEqual(actualResponse, expectedResponse);
});
