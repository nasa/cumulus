import { ThrottlingException } from '@cumulus/errors';

import { AWSClientTypes } from './types';

export const inTestMode = () => process.env.NODE_ENV === 'test';

// From https://github.com/localstack/localstack/blob/master/README.md
const localStackPorts = {
  stepfunctions: 4566,
  apigateway: 4566,
  cloudformation: 4566,
  cloudwatch: 4566,
  cloudwatchevents: 4566,
  cloudwatchlogs: 4566,
  DynamoDB: 4566,
  DynamoDBClient: 4566,
  es: 4566,
  firehose: 4566,
  iam: 4566,
  kinesis: 4566,
  kms: 4566,
  lambda: 4566,
  redshift: 4566,
  route53: 4566,
  s3: 4566,
  secretsmanager: 4566,
  ses: 4566,
  sns: 4566,
  sqs: 4566,
  ssm: 4566,
  sts: 4566,
};

/**
 * Test if a given AWS service is supported by LocalStack.
 *
 * @param {Function} serviceIdentifier - an AWS service object constructor function
 * @returns {boolean} true or false depending on whether the service is
 *   supported by LocalStack
 *
 * @private
 */
function localstackSupportedService(serviceIdentifier: string) {
  return Object.keys(localStackPorts).includes(serviceIdentifier);
}

/**
 * Returns the proper endpoint for a given aws service
 *
 * @param {string} identifier - service name
 * @returns {string} the localstack endpoint
 *
 * @private
 */
export function getLocalstackEndpoint(identifier: keyof typeof localStackPorts) {
  const key = `LOCAL_${identifier.toUpperCase()}_HOST`;
  if (process.env[key]) {
    return `http://${process.env[key]}:${localStackPorts[identifier]}`;
  }

  return `http://${process.env.LOCALSTACK_HOST}:${localStackPorts[identifier]}`;
}

const getServiceIdentifer = (service: any) => service.serviceIdentifier || service.name;

/**
 * Create an AWS service object that talks to LocalStack.
 *
 * This function expects that the LOCALSTACK_HOST environment variable will be set.
 *
 * @param {Function} Service - an AWS service object constructor function
 * @param {Object} options - options to pass to the service object constructor function
 * @returns {Object} an AWS service object
 *
 * @private
 */
function localStackAwsClient<T extends AWSClientTypes>(
  Service: new (params: object) => T,
  options: object
) {
  if (!process.env.LOCALSTACK_HOST) {
    throw new Error('The LOCALSTACK_HOST environment variable is not set.');
  }

  // @ts-ignore
  const serviceIdentifier = getServiceIdentifer(Service);
  console.log(serviceIdentifier);

  const localStackOptions: { [key: string ]: unknown } = {
    ...options,
    credentials: {
      accessKeyId: 'my-access-key-id',
      secretAccessKey: 'my-secret-access-key',
    },
    region: 'us-east-1',
    endpoint: getLocalstackEndpoint(serviceIdentifier),
  };
  console.log('localStackOptions', localStackOptions);

  if (serviceIdentifier === 'S3') localStackOptions.forcePathStyle = true;
  return new Service(localStackOptions);
}

/**
 * Create an AWS service object that does not actually talk to AWS.
 *
 * @param {Function} Service - an AWS service object constructor function
 * @param {Object} options - options to pass to the service object constructor function
 * @returns {Object} an AWS service object
 *
 * @private
 */
export function testAwsClient<T extends AWSClientTypes>(
  Service: new (params: object) => T,
  options: object
): T {
  // @ts-ignore
  const serviceIdentifier = getServiceIdentifer(Service);
  console.log('serviceIdentifier', serviceIdentifier);
  if (localstackSupportedService(serviceIdentifier)) {
    console.log('supported');
    return localStackAwsClient(Service, options);
  }

  return <T>{};
}

/**
 * Return a function that throws a ThrottlingException the first time it is called, then returns as
 * normal any other times.
 *
 * @param {Function} fn
 * @returns {Function}
 *
 * @private
 */
export const throttleOnce = (fn: (...args: unknown[]) => unknown) => {
  let throttleNextCall = true;

  return (...args: unknown[]) => {
    if (throttleNextCall) {
      throttleNextCall = false;
      throw new ThrottlingException();
    }

    return fn(...args);
  };
};
