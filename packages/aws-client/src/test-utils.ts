import * as AWS from 'aws-sdk';
import { ThrottlingException } from '@cumulus/errors';

export const inTestMode = () => process.env.NODE_ENV === 'test';

// From https://github.com/localstack/localstack/blob/master/README.md
const localStackPorts = {
  stepfunctions: 4585,
  apigateway: 4567,
  cloudformation: 4581,
  cloudwatch: 4582,
  cloudwatchevents: 4582,
  cloudwatchlogs: 4586,
  dynamodb: 4564,
  es: 4571,
  firehose: 4573,
  iam: 4593,
  kinesis: 4568,
  kms: 4599,
  lambda: 4574,
  redshift: 4577,
  route53: 4580,
  s3: 4572,
  secretsmanager: 4584,
  ses: 4579,
  sns: 4575,
  sqs: 4576,
  ssm: 4583,
  sts: 4592,
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
function localStackAwsClient<T extends AWS.Service | AWS.DynamoDB.DocumentClient>(
  Service: new (params: object) => T,
  options: object
) {
  if (!process.env.LOCALSTACK_HOST) {
    throw new Error('The LOCALSTACK_HOST environment variable is not set.');
  }

  // @ts-ignore
  const serviceIdentifier = Service.serviceIdentifier;

  const localStackOptions: { [key: string ]: unknown } = {
    ...options,
    accessKeyId: 'my-access-key-id',
    secretAccessKey: 'my-secret-access-key',
    region: 'us-east-1',
    endpoint: getLocalstackEndpoint(serviceIdentifier),
  };

  if (serviceIdentifier === 's3') localStackOptions.s3ForcePathStyle = true;

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
export function testAwsClient<T extends AWS.Service | AWS.DynamoDB.DocumentClient>(
  Service: new (params: object) => T,
  options: object
): T {
  // @ts-ignore
  const serviceIdentifier = Service.serviceIdentifier;
  if (localstackSupportedService(serviceIdentifier)) {
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
