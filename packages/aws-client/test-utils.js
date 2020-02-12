/* eslint no-console: "off" */

'use strict';

const isNil = require('lodash.isnil');

/**
 * Create a function which will allow methods of an AWS service interface object
 * to be wrapped.
 *
 * When invoked, this returned function will take two arguments:
 * - methodName - the name of the service interface object method to wrap
 * - dataHandler - a handler function which will be used to process the result
 *     of invoking `methodName`
 *
 * @param {Object} client - AWS Service interface object
 * @returns {Function} function taking a client method name and a dataHandler
 *   function to be called upon completion of the client method with return
 *   value of the client method and the original parameters passed into the
 *   client method
 *
 * @example
 * const s3 = new AWS.S3();
 *
 * // Initialize wrapper for AWS S3 service interface object
 * const s3Wrapper = awsServiceInterfaceMethodWrapper(s3);
 *
 * // Add a "RequestParams" property to the result, which shows what params were
 * // used in the `listObjects` request.  This is, obviously, a very contrived
 * // example.
 * s3Wrapper(
 *   'listObjects',
 *   (data, params) => ({ ...data, RequestParams: params })
 * );
 *
 * const result = await s3().listObjects({ Bucket: 'my-bucket' }).promise();
 *
 * assert(result.RequestParams.Bucket === 'my-bucket');
 */
const awsServiceInterfaceMethodWrapper = (client) => {
  const originalFunctions = {};

  return (methodName, dataHandler) => {
    originalFunctions[methodName] = client[methodName];

    // eslint-disable-next-line no-param-reassign
    client[methodName] = (params = {}, callback) => {
      if (callback) {
        return originalFunctions[methodName].call(
          client,
          params,
          (err, data) => {
            if (err) callback(err);
            callback(null, dataHandler(data, params));
          }
        );
      }

      return {
        promise: () => originalFunctions[methodName].call(client, params).promise()
          .then((data) => dataHandler(data, params))
      };
    };
  };
};

exports.inTestMode = () => process.env.NODE_ENV === 'test';

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
  sts: 4592
};

/**
 * Test if a given AWS service is supported by LocalStack.
 *
 * @param {Function} Service - an AWS service object constructor function
 * @returns {boolean} true or false depending on whether the service is
 *   supported by LocalStack
 */
function localstackSupportedService(Service) {
  const serviceIdentifier = Service.serviceIdentifier;
  return Object.keys(localStackPorts).includes(serviceIdentifier);
}

/**
 * Returns the proper endpoint for a given aws service
 *
 * @param {string} identifier - service name
 * @returns {string} the localstack endpoint
 */
function getLocalstackEndpoint(identifier) {
  const key = `LOCAL_${identifier.toUpperCase()}_HOST`;
  if (process.env[key]) {
    return `http://${process.env[key]}:${localStackPorts[identifier]}`;
  }

  return `http://${process.env.LOCALSTACK_HOST}:${localStackPorts[identifier]}`;
}
exports.getLocalstackEndpoint = getLocalstackEndpoint;

/**
 * Create an AWS service object that talks to LocalStack.
 *
 * This function expects that the LOCALSTACK_HOST environment variable will be set.
 *
 * @param {Function} Service - an AWS service object constructor function
 * @param {Object} options - options to pass to the service object constructor function
 * @returns {Object} - an AWS service object
 */
function localStackAwsClient(Service, options) {
  if (!process.env.LOCALSTACK_HOST) {
    throw new Error('The LOCALSTACK_HOST environment variable is not set.');
  }

  const serviceIdentifier = Service.serviceIdentifier;

  const localStackOptions = {
    ...options,
    accessKeyId: 'my-access-key-id',
    secretAccessKey: 'my-secret-access-key',
    region: 'us-east-1',
    endpoint: getLocalstackEndpoint(serviceIdentifier)
  };

  if (serviceIdentifier === 's3') localStackOptions.s3ForcePathStyle = true;

  return new Service(localStackOptions);
}

/**
 * Create an AWS service object that does not actually talk to AWS.
 *
 * @param {Function} Service - an AWS service object constructor function
 * @param {Object} options - options to pass to the service object constructor function
 * @returns {Object} - an AWS service object
 */
function testAwsClient(Service, options) {
  if (Service.serviceIdentifier === 'lambda') {
    // This is all a workaround for a Localstack bug where the Lambda event source mapping state
    // is not respected and is always 'Enabled'. To work around this, we keep the state of each
    // event source mapping internally and override the event source mapping functions to set
    // and use the internal states. This can be removed when the Localstack issue is fixed.
    const lambdaClient = localStackAwsClient(Service, options);

    const eventSourceMappingStates = {};

    const deleteState = (UUID) => {
      delete eventSourceMappingStates[UUID];
    };

    const getState = (UUID) => eventSourceMappingStates[UUID];

    const setState = (state, UUID) => {
      eventSourceMappingStates[UUID] = state;
    };

    const lambdaWrapper = awsServiceInterfaceMethodWrapper(lambdaClient);

    lambdaWrapper(
      'createEventSourceMapping',
      (data, params) => {
        setState((isNil(params.Enabled) || params.Enabled) ? 'Enabled' : 'Disabled', data.UUID);
        return { ...data, State: getState(data.UUID) };
      }
    );

    lambdaWrapper(
      'deleteEventSourceMapping',
      (data, params) => {
        deleteState(params.UUID);
        return { ...data, State: '' };
      }
    );

    lambdaWrapper(
      'getEventSourceMapping',
      (data) => ({ ...data, State: getState(data.UUID) })
    );

    lambdaWrapper(
      'listEventSourceMappings',
      (data) => ({
        ...data,
        EventSourceMappings: data.EventSourceMappings
          .filter((esm) => Object.keys(eventSourceMappingStates).includes(esm.UUID))
          .map((esm) => ({ ...esm, State: getState(esm.UUID) }))
      })
    );

    lambdaWrapper(
      'updateEventSourceMapping',
      (data, params) => {
        if (!isNil(params.Enabled)) {
          const enabled = isNil(params.Enabled) || params.Enabled;
          setState(enabled ? 'Enabled' : 'Disabled', data.UUID);
        }
        return { ...data, State: getState(data.UUID) };
      }
    );

    return lambdaClient;
  }

  if (localstackSupportedService(Service)) {
    return localStackAwsClient(Service, options);
  }

  return {};
}
exports.testAwsClient = testAwsClient;
