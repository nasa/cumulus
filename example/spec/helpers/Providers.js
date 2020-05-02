'use strict';

const isIp = require('is-ip');
const providersApi = require('@cumulus/api-client/providers');
const { getTextObject } = require('@cumulus/aws-client/S3');

const fetchFakeProviderIp = async () => {
  if (!process.env.FAKE_PROVIDER_CONFIG_BUCKET) {
    throw new Error('The FAKE_PROVIDER_CONFIG_BUCKET environment variable must be set');
  }

  const ip = (await getTextObject(
    process.env.FAKE_PROVIDER_CONFIG_BUCKET, 'fake-provider-ip'
  )).trim();

  if (!isIp(ip)) {
    throw new Error(
      `Invalid fake provider IP "${ip}" fetched from s3://${process.env.FAKE_PROVIDER_CONFIG_BUCKET}/fake-provider-ip`
    );
  }

  return ip;
};

const getProviderHost = async () => process.env.PROVIDER_HOST || fetchFakeProviderIp();

const buildFtpProvider = async (postfix = '') => {
  const provider = {
    id: `ftp_provider${postfix}`,
    protocol: 'ftp',
    host: await getProviderHost(),
    username: 'testuser',
    password: 'testpass',
    globalConnectionLimit: 10
  };

  if (process.env.PROVIDER_FTP_PORT) {
    provider.port = Number(process.env.PROVIDER_FTP_PORT);
  }

  return provider;
};

const fakeProviderPortMap = {
  http: 3030,
  https: 4040
};

const buildHttpOrHttpsProvider = async (postfix = '', protocol = 'http') => {
  const provider = {
    id: `${protocol}_provider${postfix}`,
    protocol,
    host: await getProviderHost(),
    port: fakeProviderPortMap[protocol],
    globalConnectionLimit: 10
  };

  if (protocol === 'https') {
    provider.certificateUri = `s3://${process.env.FAKE_PROVIDER_CONFIG_BUCKET}/fake-provider-cert.pem`;
  }

  if (process.env.PROVIDER_HTTP_PORT) {
    provider.port = Number(process.env.PROVIDER_HTTP_PORT);
  }

  return provider;
};

const createProvider = async (stackName, provider) => {
  await providersApi.deleteProvider({ prefix: stackName, providerId: provider.id });
  await providersApi.createProvider({ prefix: stackName, provider: provider });
};

module.exports = {
  buildFtpProvider,
  buildHttpOrHttpsProvider,
  createProvider
};
