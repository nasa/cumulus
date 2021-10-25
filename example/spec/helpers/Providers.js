'use strict';

const isIp = require('is-ip');
const pWaitFor = require('p-wait-for');

const providersApi = require('@cumulus/api-client/providers');
const { listGranules } = require('@cumulus/api-client/granules');
const { listRules, deleteRule } = require('@cumulus/api-client/rules');
const pdrsApi = require('@cumulus/api-client/pdrs');
const { getTextObject, s3CopyObject } = require('@cumulus/aws-client/S3');

const { deleteGranules } = require('./granuleUtils');

const fetchFakeS3ProviderBuckets = async () => {
  if (!process.env.FAKE_PROVIDER_CONFIG_BUCKET) {
    throw new Error('The FAKE_PROVIDER_CONFIG_BUCKET environment variable must be set');
  }

  const fakeS3ProviderBucket = (await getTextObject(
    process.env.FAKE_PROVIDER_CONFIG_BUCKET, 'fake-s3-provider-bucket'
  )).trim();

  const altFakeS3ProviderBucket = (await getTextObject(
    process.env.FAKE_PROVIDER_CONFIG_BUCKET, 'fake-s3-provider-bucket-alternate'
  )).trim();
  return { fakeS3ProviderBucket, altFakeS3ProviderBucket };
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

const getProviderHost = async () => process.env.PROVIDER_HOST || await fetchFakeProviderIp();

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

const throwIfApiReturnFail = (apiResult) => {
  if (apiResult.statusCode === 500) {
    throw new Error(`API returned a 500 status: ${apiResult}, failing.`);
  }
};

const createProvider = async (stackName, provider) => {
  const createProviderResult = await providersApi.createProvider({ prefix: stackName, provider });
  throwIfApiReturnFail(createProviderResult);
  return createProviderResult;
};

const waitForProviderRecordInOrNotInList = async (
  prefix, id, recordIsIncluded = true, additionalQueryParams = {}
) => await pWaitFor(
  async () => {
    const resp = await providersApi.getProviders({
      prefix,
      queryStringParameters: {
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

const deleteProvidersByHost = async (prefix, host) => {
  const resp = await providersApi.getProviders({
    prefix,
    queryStringParameters: {
      fields: 'id',
      host,
    },
  });
  const ids = JSON.parse(resp.body).results.map((p) => p.id);
  const deletes = ids.map((id) => providersApi.deleteProvider({
    prefix,
    providerId: id,
  }));
  await Promise.all(deletes).catch(console.error);
  await Promise.all(ids.map((id) => waitForProviderRecordInOrNotInList(prefix, id, false)));
};

const deleteProvidersAndAllDependenciesByHost = async (prefix, host) => {
  console.log('Starting Provider/Dependency Deletion');

  const resp = await providersApi.getProviders({
    prefix,
    queryStringParameters: {
      fields: 'id',
      host,
    },
  });
  const ids = JSON.parse(resp.body).results.map((p) => p.id);

  console.log('Starting Granule Deletion');

  const granuleResponse = await Promise.all(ids.map((id) => listGranules({
    prefix,
    query: {
      fields: ['published', 'granuleId'],
      'provider.keyword': id,
    },
  })));

  const granulesForDeletion = granuleResponse.map((r) => JSON.parse(r.body).results).flat();
  await deleteGranules(prefix, granulesForDeletion);

  console.log('Granule Deletion Complete');

  console.log('Starting PDR deletion');

  const pdrResponse = await Promise.all(
    ids.map((id) =>
      pdrsApi.getPdrs({
        prefix,
        query: {
          'provider.keyword': id,
        },
      }))
  );
  const pdrsToDelete = pdrResponse.map((r) => JSON.parse(r.body).results).flat();
  if (pdrsToDelete.length > 0) {
    const pdrNames = await Promise.all(pdrsToDelete.map((body) => body.pdrName));
    await Promise.all(pdrNames.map((pdrName) => pdrsApi.deletePdr({
      prefix,
      pdrName,
    })));
  }
  console.log('PDR deletion complete');

  console.log('Starting Rule deletion');

  const ruleResponse = await Promise.all(
    ids.map((id) =>
      listRules({
        prefix,
        query: {
          'provider.keyword': id,
        },
      }))
  );
  const rulesForDeletion = ruleResponse.map((r) => JSON.parse(r.body).results).flat();
  await Promise.all(rulesForDeletion.map((rule) => deleteRule({
    prefix,
    ruleName: rule.name,
  })));

  console.log('Rule deletion complete');

  console.log('Deleting provider');

  const providerDeletes = ids.map((id) => providersApi.deleteProvider({
    prefix,
    providerId: id,
  }));
  await Promise.all(providerDeletes);
  await Promise.all(ids.map((id) => waitForProviderRecordInOrNotInList(prefix, id, false)));
};

module.exports = {
  buildFtpProvider,
  buildHttpOrHttpsProvider,
  createProvider,
  deleteProvidersByHost,
  fetchFakeS3ProviderBuckets,
  waitForProviderRecordInOrNotInList,
  deleteProvidersAndAllDependenciesByHost,
};
