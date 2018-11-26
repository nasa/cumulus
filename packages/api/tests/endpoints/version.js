'use strict';

const test = require('ava');
const versionEndpoint = require('../../endpoints/version');
const pckg = require('../../package.json');

test('returns expected response', async (t) => {
  const response = await versionEndpoint();

  t.is(response.statusCode, 200);

  const body = JSON.parse(response.body);
  t.is(body.response_version, 'v1');
  t.is(body.api_version, pckg.version);
});
