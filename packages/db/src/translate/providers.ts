import { removeNilProperties } from '@cumulus/common/util';
import { envUtils } from '@cumulus/common';
import { KMS } from '@cumulus/aws-client';
import { ApiProvider } from '@cumulus/types';
import { PostgresProvider, PostgresProviderRecord } from '../types/provider';

export const encryptValueWithKMS = (
  value: string,
  encryptFunction: Function = KMS.encrypt
): Promise<string> => {
  const providerKmsKeyId = envUtils.getRequiredEnvVar('provider_kms_key_id');
  return encryptFunction(providerKmsKeyId, value);
};

export const translatePostgresProviderToApiProvider = (
  record: PostgresProviderRecord
): ApiProvider => {
  const apiProvider = {
    id: record.name,
    cmKeyId: record.cm_key_id,
    certificateUri: record.certificate_uri,
    privateKey: record.private_key,
    globalConnectionLimit: record.global_connection_limit,
    port: record.port,
    host: record.host,
    protocol: record.protocol,
    createdAt: record.created_at.getTime(),
    updatedAt: record.updated_at.getTime(),
    username: record.username,
    password: record.password,
    allowedRedirects: record.allowed_redirects,
  } as ApiProvider;
  if (record.username || record.password) {
    apiProvider.encrypted = true;
  }
  return <ApiProvider>removeNilProperties(apiProvider);
};

/**
* Translates API Provider record to Postgres Provider record
*
* @param {ApiProvider} record - ApiProvider record to translate
* @param {Function} [encryptMethod] - The encryption method to use, defaults to encryptValueWithKMS
* @returns {Promise<PostgresProvider>} Returns a PostgresProvider object
*/
export const translateApiProviderToPostgresProvider = async (
  record: ApiProvider,
  encryptMethod: Function = encryptValueWithKMS
): Promise<PostgresProvider> => {
  let username: string | undefined;
  let password: string | undefined;
  if (record.username) {
    username = await encryptMethod(record.username);
  }
  if (record.password) {
    password = await encryptMethod(record.password);
  }
  return ({
    created_at: (record.createdAt ? new Date(record.createdAt) : undefined),
    updated_at: (record.updatedAt ? new Date(record.updatedAt) : undefined),
    name: record.id,
    cm_key_id: record.cmKeyId,
    certificate_uri: record.certificateUri,
    private_key: record.privateKey,
    global_connection_limit: record.globalConnectionLimit,
    port: record.port,
    host: record.host,
    protocol: record.protocol,
    allowed_redirects: record.allowedRedirects,
    username,
    password,
  });
};
