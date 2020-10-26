'use strict';

const isIp = require('is-ip');
const pWaitFor = require('p-wait-for');
const providersApi = require('@cumulus/api-client/providers');
const { getTextObject, s3CopyObject } = require('@cumulus/aws-client/S3');

const fetchFakeS3ProviderBucket = async () => {
  if (!process.env.FAKE_PROVIDER_CONFIG_BUCKET) {
    throw new Error('The FAKE_PROVIDER_CONFIG_BUCKET environment variable must be set');
  }

  return (await getTextObject(
    process.env.FAKE_PROVIDER_CONFIG_BUCKET, 'fake-s3-provider-bucket'
  )).trim();
};

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
    globalConnectionLimit: 10,
  };

  if (process.env.PROVIDER_FTP_PORT) {
    provider.port = Number(process.env.PROVIDER_FTP_PORT);
  }

  return provider;
};

const fakeProviderPortMap = {
  http: process.env.PROVIDER_HTTP_PORT ? Number(process.env.PROVIDER_HTTP_PORT) : 3030,
  https: process.env.PROVIDER_HTTPS_PORT ? Number(process.env.PROVIDER_HTTPS_PORT) : 4040,
};

const buildHttpOrHttpsProvider = async (postfix, systemBucket, protocol = 'http') => {
  if (postfix === undefined) throw new Error('Test setup should be isolated, specify postfix!');
  const provider = {
    id: `${protocol}_provider${postfix}`,
    protocol,
    host: await getProviderHost(),
    port: fakeProviderPortMap[protocol],
    globalConnectionLimit: 10,
  };

  if (protocol === 'https') {
    if (systemBucket === undefined) throw new Error('HTTPS provider must have systembucket specified!');
    // copy certificate to system bucket to avoid permissions issues
    if (systemBucket !== process.env.FAKE_PROVIDER_CONFIG_BUCKET) {
      await s3CopyObject({
        CopySource: `${process.env.FAKE_PROVIDER_CONFIG_BUCKET}/fake-provider-cert.pem`,
        Bucket: systemBucket,
        Key: 'fake-provider-cert.pem',
      });
    }
    provider.certificateUri = `s3://${systemBucket}/fake-provider-cert.pem`;
  }

  return provider;
};

const createProvider = async (stackName, provider) => {
  await providersApi.deleteProvider({ prefix: stackName, providerId: provider.id });
  await providersApi.createProvider({ prefix: stackName, provider: provider });
};

const deleteProvidersByNodeName = async (stackName, nodeName) => {
  const resp = await providersApi.getProviders({
    prefix: stackName,
    query: {
      fields: 'id',
      host: nodeName,
    },
  });
  const ids = JSON.parse(resp.body).results.map((p) => p.id);
  console.log('deleteProvidersByNodeName', ids);
  const deletes = ids.map((id) => providersApi.deleteProvider({
    prefix: stackName,
    providerId: id,
  }));
  await Promise.all(deletes).catch(console.error);
  await Promise.all(ids.map((id) => exports.waitForProviderRecordInOrNotInList(stackName, id, false)));
};

const waitForProviderRecordInOrNotInList = async (
  stackName, id, recordIsIncluded = true, additionalQueryParams = {}
) => pWaitFor(
  async () => {
    const resp = await providersApi.getProviders({
      prefix: stackName,
      query: {
        fields: 'id',
        id,
        ...additionalQueryParams,
      },
    });
    const ids = JSON.parse(resp.body).results.map((p) => p.id);
    return recordIsIncluded ? ids.includes(id) : !ids.includes(id);
  },
  {
    interval: 10000,
    timeout: 600 * 1000,
  }
);

module.exports = {
  buildFtpProvider,
  buildHttpOrHttpsProvider,
  createProvider,
  deleteProvidersByNodeName,
  fetchFakeS3ProviderBucket,
  waitForProviderRecordInOrNotInList,
};
