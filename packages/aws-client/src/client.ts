import AWS from 'aws-sdk';
import mem from 'mem';

import { inTestMode, getLocalstackAwsClientOptions } from './test-utils';
import { AWSClientTypes } from './types';
import { getServiceIdentifer } from './utils';

const getRegion = () => process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1';

AWS.config.setPromisesDependency(Promise);

const buildServiceClient = (Service: any, options?: object) => {
  if (inTestMode()) {
    return new Service(getLocalstackAwsClientOptions(Service, options));
  }
  return new Service(options);
};

const getMemoizedClient = mem(buildServiceClient, {
  cacheKey: (arguments_) => `${getServiceIdentifer(arguments_[0])}${JSON.stringify(arguments_[1])}`,
});

const getServiceClient = <T extends AWSClientTypes>(
  Service: new (params: object) => T,
  options: object = {}
) => (overrides?: object) => getMemoizedClient(Service, Object.assign(options, overrides));

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
const awsClient = <T extends AWSClientTypes>(
  Service: new (params: object) => T,
  version?: string,
  serviceOptions?: object
): (params?: object) => T => {
  const options: { region: string, apiVersion?: string } = {
    region: getRegion(),
    ...serviceOptions,
  };
  if (version) options.apiVersion = version;
  if (inTestMode()) {
    // @ts-ignore - serviceIdentifier is not part of the public API and may break at any time
    if (AWS.DynamoDB.DocumentClient.serviceIdentifier === undefined) {
      // @ts-ignore - serviceIdentifier is not part of the public API and may break at any time
      AWS.DynamoDB.DocumentClient.serviceIdentifier = 'dynamodbclient';
    }
  }
  return getServiceClient(Service, options);
};

export = awsClient;
