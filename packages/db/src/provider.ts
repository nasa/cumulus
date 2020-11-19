//import { toSnake } from 'snake-camel';
import isNil from 'lodash/isNil';
import isValidHostname from 'is-valid-hostname';
import omit from 'lodash/omit';


import { PostgresValidationError } from '@cumulus/errors';
import { envUtils } from '@cumulus/common';
import { KMS } from '@cumulus/aws-client';
import { ApiProvider } from '@cumulus/types';
import { PostgresProvider } from './types';

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

/**
* Nullifies 'optional' values in the Provider object
* @summary This is require as updates to knex objects will ignore 'undefined' object keys
* rather than remove them as required
*
* @param {PostgresProvider} data - PostgresProvider object to be updated with
* null values
* @returns {PostgresProvider} - PostgresProvider with 'nullified' values
*/
export const nullifyUndefinedProviderValues = (
  data: PostgresProvider
): PostgresProvider => {
  const returnData : PostgresProvider = { ...data };
  const optionalValues : Array<keyof PostgresProvider> = [
    'port',
    'username',
    'password',
    'global_connection_limit',
    'private_key',
    'cm_key_id',
    'certificate_uri',
  ];

  optionalValues.forEach((value: keyof PostgresProvider) => {
    if (returnData[value] === undefined) {
      // eslint-disable-next-line unicorn/no-null
      Object.assign(returnData, { [value]: null });
    }
  });
  return returnData;
};

/**
* Uses isValidHostname to validate if provider host is valid
* @param {string} host            - Hostname to validate
* @returns {undefined}            - Returns undefined if hostname valid
* @throws PostgresValidationError - Throws PostgresValidationError if
*                                   host is not valid
*/
export const validateProviderHost = (host: string) => {
  if (isNil(host)) return;
  if (isValidHostname(host)) return;

  const error = new PostgresValidationError('The record has validation errors');
  error.detail = `${host} is not a valid hostname or IP address`;
  throw error;
};
