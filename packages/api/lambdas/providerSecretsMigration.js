'use strict';

const KMS = require('@cumulus/aws-client/KMS');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { S3KeyPairProvider } = require('@cumulus/common/key-pair-provider');
const { isNil } = require('@cumulus/common/util');
const Provider = require('../models/providers');

const getDecryptedField = async (provider, field) => {
  if (isNil(provider[field])) return undefined;
  if (provider.encrypted === false) return provider[field];

  return KMS.decryptBase64String(provider[field])
    .catch(() => S3KeyPairProvider.decrypt(provider[field]));
};

const migrateProvider = async (provider) => {
  try {
    const username = await getDecryptedField(provider, 'username');
    const password = await getDecryptedField(provider, 'password');

    const updates = {};
    if (username) updates.username = username;
    if (password) updates.password = password;

    const providerModel = new Provider();
    return providerModel.update({ id: provider.id }, updates);
  } catch (error) {
    error.provider = provider;
    throw error;
  }
};

const handler = async () => {
  const scanResponse = await dynamodbDocClient().scan({
    TableName: process.env.ProvidersTable
  }).promise();

  try {
    await Promise.all(scanResponse.Items.map(migrateProvider));
    return { status: 'success' };
  } catch (error) {
    const failingProvider = error.provider;
    delete error.provider;
    return {
      status: 'failure',
      failingProvider,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack.split('\n')
      }
    };
  }
};

module.exports = { handler };
