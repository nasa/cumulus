import omit from 'lodash/omit';
import isNil from 'lodash/isNil';
import isValidHostname from 'is-valid-hostname';

import { ProviderRecord, PostgresProviderRecord } from '@cumulus/types';
import { PostgresValidationError } from '@cumulus/errors';
import { envUtils } from '@cumulus/common';


import KMS from '@cumulus/aws-client/KMS';

export const encryptValueWithKMS = (
  value: string
): Promise<string> => {
  const providerKmsKeyId = envUtils.getRequiredEnvVar('provider_kms_key_id');
  return KMS.encrypt(providerKmsKeyId, value);
};

export const postgresProviderFromCumulusProvider = async (
  data: ProviderRecord,
  encryptMethod: Function = encryptValueWithKMS
) => {
  let username: string | undefined;
  let password: string | undefined;
  if (data.username) {
    username = await encryptMethod(data.username);
  }
  if (data.password) {
    password = await encryptMethod(data.password);
  }
  return ({
    ...(omit(data, ['id', 'encrypted', 'createdAt', 'updatedAt'])),
    name: data.id,
    created_at: data.createdAt,
    updated_at: data.updatedAt,
    username,
    password,
  });
};
export const nullifyUndefinedProviderValues = (
  data: PostgresProviderRecord
): PostgresProviderRecord => {
  const returnData = { ...data };
  const optionalValues = ['port', 'username', 'password', 'globalConnectionLimit', 'privateKey', 'cmKeyId', 'certificateUri'];
  optionalValues.forEach((value) => {
    // eslint-disable-next-line unicorn/no-null
    returnData[value] = returnData[value] ? returnData[value] : null;
  });
  return returnData;
};

export const validateProviderHost = (host: string) => {
  if (isNil(host)) return;
  if (isValidHostname(host)) return;

  const error = new PostgresValidationError('The record has validation errors');
  error.detail = `${host} is not a valid hostname or IP address`;
  throw error;
};
