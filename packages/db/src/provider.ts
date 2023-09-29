import isNil from 'lodash/isNil';
import isValidHostname from 'is-valid-hostname';

import { PostgresValidationError } from '@cumulus/errors';
import { PostgresProvider } from './types/provider';

/**
* Nullifies 'optional' values in the Provider object
* @summary This is required as updates to knex objects will ignore 'undefined' object keys
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
    'max_download_time',
    'private_key',
    'cm_key_id',
    'certificate_uri',
    'allowed_redirects',
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
