import { inTestMode, testAwsClient } from './test-utils';

import { AWSClientTypes } from './types';

export const getRegion = () => process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1';

const memoize = <T>(fn: (options?: object) => T): (options?: object) => T => {
  let memo: T;
  return (options) => {
    if (!memo) memo = fn(options);
    return memo;
  };
};

/**
 * Return a function which, when called, will return an AWS service object
 *
 * Note: The returned service objects are cached, so there will only be one
 *       instance of each service object per process.
 *
 * @param {AWS.Service} Service - an AWS service object constructor function
 * @param {string} [version] - the API version to use
 * @param {string} [serviceOptions] - additional options to pass to the service
 *
 * @returns {Function} a function which, when called, will return an instance of an AWS service
 * object
 *
 * @private
 */
export const awsClient = <T extends AWSClientTypes>(
  Service: new (params: object) => T,
  version?: string,
  serviceOptions?: object
): (options?: object) => T => {
  const options: { region: string, apiVersion?: string } = {
    region: getRegion(),
    ...serviceOptions,
  };
  if (version) options.apiVersion = version;

  if (inTestMode()) {
    return memoize((o) => testAwsClient(Service, Object.assign(options, o)));
  }
  return memoize((o) => new Service(Object.assign(options, o)));
};
