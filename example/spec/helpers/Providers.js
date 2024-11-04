'use strict';

const pWaitFor = require('p-wait-for');
const pRetry = require('p-retry');

const providersApi = require('@cumulus/api-client/providers');
const { listGranules } = require('@cumulus/api-client/granules');
const { listRules, deleteRule } = require('@cumulus/api-client/rules');
const pdrsApi = require('@cumulus/api-client/pdrs');
const { getTextObject, s3CopyObject } = require('@cumulus/aws-client/S3');
const { fetchFakeProviderIp } = require('@cumulus/common/fake-provider');

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

const getProviderHost = async () => process.env.PROVIDER_HOST || await fetchFakeProviderIp();

const buildFtpProvider = async (postfix = '') => {
  const provider = {
    id: `ftp_provider${postfix}`,
    protocol: 'ftp',
    host: await getProviderHost(),
    username: 'testuser',
    password: 'testpass',
    globalConnectionLimit: 10,
    maxDownloadTime: 500,
  };

  if (process.env.PROVIDER_FTP_PORT) {
    provider.port = Number(process.env.PROVIDER_FTP_PORT);
  }

  return provider;
};

const buildSftpProvider = async (postfix = '') => {
  const provider = {
    id: `sftp_provider${postfix}`,
    protocol: 'sftp',
    host: await getProviderHost(),
    username: 'testuser',
    password: 'testpass',
    globalConnectionLimit: 10,
    maxDownloadTime: 500,
  };

  if (process.env.PROVIDER_SFTP_PORT) {
    provider.port = Number(process.env.PROVIDER_SFTP_PORT);
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
    maxDownloadTime: 360,
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

const providerExists = async (stackName, id) => {
  let response;
  const exists = await pRetry(
    async () => {
      try {
        response = await providersApi.getProvider({
          prefix: stackName,
          providerId: id,
          pRetryOptions: {
            retries: 0,
          },
        });
      } catch (error) {
        if (error.statusCode === 404) {
          console.log(`Error: ${error}. Failed to get provider with ID ${id}`);
          return false;
        }
        throw error;
      }
      if (response.statusCode === 200) return true;
      return false;
    },
    { retries: 5, minTimeout: 2000, maxTimeout: 2000 }
  );
  return exists;
};

const createProvider = async (stackName, provider) => {
  const exists = await providerExists(stackName, provider.id);
  if (exists) {
    await providersApi.deleteProvider({ prefix: stackName, providerId: provider.id });
  }
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
  if (ids.length === 0) {
    console.log('No Provider IDs to Delete, Exiting');
    return;
  }

  console.log('Starting Granule Deletion');

  const granuleResponse = await Promise.all(ids.map((id) => listGranules({
    prefix,
    query: {
      fields: ['published', 'granuleId', 'collectionId'],
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
  if (rulesForDeletion.length > 0) {
    await Promise.all(rulesForDeletion.map((rule) => deleteRule({
      prefix,
      ruleName: rule.name,
    })));
  }

  console.log('Rule deletion complete');

  console.log('Deleting provider');

  const providerDeletes = ids.map((id) => providersApi.deleteProvider({
    prefix,
    providerId: id,
    expectedStatusCodes: [404, 200],
  }));
  await Promise.all(providerDeletes);
  await Promise.all(ids.map((id) => waitForProviderRecordInOrNotInList(prefix, id, false)));
};

module.exports = {
  buildFtpProvider,
  buildHttpOrHttpsProvider,
  buildSftpProvider,
  createProvider,
  fetchFakeProviderIp,
  fetchFakeS3ProviderBuckets,
  waitForProviderRecordInOrNotInList,
  deleteProvidersAndAllDependenciesByHost,
};
