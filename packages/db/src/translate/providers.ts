import omit from 'lodash/omit';

import { envUtils } from '@cumulus/common';
import { KMS } from '@cumulus/aws-client';
import { ApiProvider } from '@cumulus/types';
import { PostgresProvider } from '../types/provider';

export const encryptValueWithKMS = (
  value: string,
  encryptFunction: Function = KMS.encrypt
): Promise<string> => {
  const providerKmsKeyId = envUtils.getRequiredEnvVar('provider_kms_key_id');
  return encryptFunction(providerKmsKeyId, value);
};

/**
* Translates API Provider record to Postgres Provider record
*
* @param {ApiProvider} data - ApiProvider record to translate
* @param {Function} [encryptMethod] - The encryption method to use, defaults to encryptValueWithKMS
* @returns {Promise<PostgresProvider>} Returns a PostgresProvider object
*/
export const translateApiProviderToPostgresProvider = async (
  data: ApiProvider,
  encryptMethod: Function = encryptValueWithKMS
): Promise<PostgresProvider> => {
  let username: string | undefined;
  let password: string | undefined;
  if (data.username) {
    username = await encryptMethod(data.username);
  }
  if (data.password) {
    password = await encryptMethod(data.password);
  }
  return ({ // TODO - rewrite this using snake
    ...(omit(data, [
      'id',
      'encrypted',
      'cmKeyId',
      'certificateUri',
      'privateKey',
      'globalConnectionLimit',
      'createdAt',
      'updatedAt',
    ])),
    created_at: data.createdAt,
    updated_at: data.updatedAt,
    name: data.id,
    cm_key_id: data.cmKeyId,
    certificate_uri: data.certificateUri,
    private_key: data.privateKey,
    global_connection_limit: data.globalConnectionLimit,
    username,
    password,
  });
};
