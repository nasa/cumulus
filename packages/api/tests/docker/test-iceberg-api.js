'use strict';

const test = require('ava');
const got = require('got');
const isString = require('lodash/isString');
const { randomString } = require('@cumulus/common/test-utils');
const { createJwtToken } = require('../../lib/token');
const { localUserName } = require('../../bin/local-test-defaults');

const REQUIRED_ENV_KEYS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCOUNT_ID',
  'AWS_REGION',
  'api_config_secret_id',
  'dynamoTableNameString',
  'ICEBERG_NAMESPACE',
];

let baseUrl;
let authToken;

const icebergRoutes = [
  '/granules',
  '/collections',
  '/executions',
  '/providers',
  '/pdrs',
  '/rules',
  '/async-operations',
  '/stats/aggregate/granules?field=status',
].flatMap((route) => [route, `/v1${route}`]);

const defaultGotOptions = {
  throwHttpErrors: false,
  retry: 0,
};

const defaultJsonGotOptions = {
  ...defaultGotOptions,
  responseType: 'json',
};

function buildAuthHeaders() {
  return { authorization: `Bearer ${authToken}` };
}

test.before(() => {
  const hostPort = process.env.ICEBERG_PORT || process.env.PORT || '5001';
  baseUrl = `http://localhost:${hostPort}`;

  const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !process.env[key]);
  if (missingKeys.length > 0) {
    throw new Error(`Environment missing required keys: ${missingKeys.join(', ')}`);
  }

  const tokenSecret = process.env.TOKEN_SECRET || randomString();
  process.env.TOKEN_SECRET = tokenSecret;
  authToken = createJwtToken({
    accessToken: randomString(),
    username: localUserName,
    expirationTime: Math.floor(Date.now() / 1000) + 3600 * 24,
  });
});

test.serial('Iceberg API version endpoint returns version payload', async (t) => {
  const response = await got(`${baseUrl}/version`, {
    ...defaultJsonGotOptions,
  });

  t.is(response.statusCode, 200);
  t.truthy(response.body.response_version);
  t.truthy(response.body.api_version);
});

test.serial('Iceberg API providers endpoint returns expected metadata payload', async (t) => {
  const response = await got(`${baseUrl}/providers`, {
    ...defaultJsonGotOptions,
    headers: buildAuthHeaders(),
  });

  t.is(response.statusCode, 200);
  t.is(response.body.meta.name, 'cumulus-iceberg-api');
  t.is(response.body.meta.table, 'providers');
  t.true(Number.isInteger(response.body.meta.count));
  t.true(response.body.meta.count >= 1);
  t.true(Array.isArray(response.body.results));
  t.true(response.body.results.length >= 1);
  t.true(response.body.results.some((provider) => provider.id === 's3-provider'));
  t.true(response.body.results.every((provider) => isString(provider.id)));
});

test.serial('Iceberg API routes return 200 and expected API name in metadata', async (t) => {
  const headers = buildAuthHeaders();

  for (const route of icebergRoutes) {
    // eslint-disable-next-line no-await-in-loop
    const response = await got(`${baseUrl}${route}`, {
      ...defaultJsonGotOptions,
      headers,
    });

    t.is(response.statusCode, 200, `${route} should return HTTP 200`);
    t.is(
      response.body.meta?.name,
      'cumulus-iceberg-api',
      `${route} should include meta.name=cumulus-iceberg-api`
    );
  }
});

test.serial('Iceberg API protected routes reject unauthenticated requests', async (t) => {
  for (const route of icebergRoutes) {
    // eslint-disable-next-line no-await-in-loop
    const response = await got(`${baseUrl}${route}`, {
      ...defaultGotOptions,
    });

    t.is(
      response.statusCode,
      401,
      `${route} should reject unauthenticated requests with 401`
    );
  }
});
