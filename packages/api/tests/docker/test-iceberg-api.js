'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const got = require('got');
const isString = require('lodash/isString');
const { execSync } = require('child_process');
const { randomString } = require('@cumulus/common/test-utils');
const { createJwtToken } = require('../../lib/token');
const { localUserName } = require('../../bin/local-test-defaults');

const REQUIRED_ENV_FILE_KEYS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCOUNT_ID',
  'AWS_REGION',
  'NODE_ENV',
  'api_config_secret_id',
  'dynamoTableNameString',
  'ICEBERG_NAMESPACE',
];

const repoRoot = path.resolve(__dirname, '../../../..');
const defaultEnvFile = path.join(repoRoot, 'packages/api/app/.env.local');

let containerStarted = false;
let containerName;
let baseUrl;
let authToken;
let keepContainer;

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

function parseEnvFile(filePath) {
  const values = {};
  const raw = fs.readFileSync(filePath, 'utf8');

  raw.split(/\r?\n/u).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) return;

    const key = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim();
    values[key] = value;
  });

  return values;
}

function assertDockerAvailable() {
  execSync('docker --version', { stdio: 'ignore' });
}

function assertDockerImageAvailable(imageTag) {
  execSync(`docker image inspect ${imageTag}`, { stdio: 'ignore' });
}

function cleanupContainer() {
  try {
    execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
  } catch (_error) {
    // Container may not exist/already be removed.
  }
}

async function waitForHealth(url, timeoutSeconds) {
  const deadline = Date.now() + (timeoutSeconds * 1000);

  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await got(`${url}/health`, {
        throwHttpErrors: false,
        retry: 0,
      });

      if (response.statusCode === 200) return;
    } catch (_error) {
      // Server may not yet be listening; continue retrying.
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Timed out waiting for ${url}/health to return 200.`);
}

test.before(async () => {
  const imageTag = process.env.ICEBERG_IMAGE_TAG || 'cumulus-iceberg-api:latest';
  containerName = process.env.ICEBERG_CONTAINER_NAME || 'cumulus-iceberg-api-local-test';
  const hostPort = process.env.ICEBERG_PORT || '5001';
  const healthTimeoutSeconds = Number(process.env.ICEBERG_HEALTH_TIMEOUT_SECONDS || '180');
  const envFile = process.env.ICEBERG_ENV_FILE || defaultEnvFile;
  keepContainer = process.env.ICEBERG_KEEP_CONTAINER === 'true';
  baseUrl = `http://localhost:${hostPort}`;

  assertDockerAvailable();

  if (!fs.existsSync(envFile)) {
    throw new Error(
      `Env file not found: ${envFile}. Copy packages/api/app/env.local.example `
      + 'to packages/api/app/.env.local and fill values.'
    );
  }

  const envValues = parseEnvFile(envFile);
  const missingKeys = REQUIRED_ENV_FILE_KEYS.filter((key) => !envValues[key]);
  if (missingKeys.length > 0) {
    throw new Error(`Env file missing required keys: ${missingKeys.join(', ')}`);
  }

  try {
    assertDockerImageAvailable(imageTag);
  } catch (_error) {
    throw new Error(
      `Required Docker image not found: ${imageTag}. Build it first, for example: `
      + `docker build --platform linux/arm64 -f packages/api/app/Dockerfile -t ${imageTag} ${repoRoot}`
    );
  }

  try {
    cleanupContainer();
  } catch (_error) {
    // Ignore pre-existing container cleanup errors.
  }

  const tokenSecret = randomString();
  process.env.TOKEN_SECRET = tokenSecret;
  authToken = createJwtToken({
    accessToken: randomString(),
    username: localUserName,
    expirationTime: Math.floor(Date.now() / 1000) + 3600 * 24,
  });

  execSync(
    `docker run --rm -d --name ${containerName} -p ${hostPort}:5001 --env-file ${envFile} -e FAKE_AUTH=true -e TOKEN_SECRET=${tokenSecret} ${imageTag}`,
    { stdio: 'inherit' }
  );
  containerStarted = true;

  try {
    await waitForHealth(baseUrl, healthTimeoutSeconds);
  } catch (error) {
    let logs = '';
    try {
      logs = execSync(`docker logs ${containerName}`, { encoding: 'utf8' });
    } catch (logError) {
      logs = `Also failed to read container logs: ${logError.message}`;
    }
    throw new Error(`${error.message}\nContainer logs:\n${logs}`);
  }
});

test.after.always(() => {
  if (!containerStarted || keepContainer) return;
  cleanupContainer();
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

    t.true(
      [401, 403].includes(response.statusCode),
      `${route} should reject unauthenticated requests with 401 or 403`
    );
  }
});
