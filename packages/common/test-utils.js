/* eslint no-console: "off" */

'use strict';

const Ajv = require('ajv');
const crypto = require('crypto');
const path = require('path');
const RandExp = require('randexp');
const fs = require('fs-extra');
const { isNil } = require('./util');

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

/**
 * Helper function to throw error for unit test exports
 * @throws {Error}
 */
function throwTestError() {
  throw (new Error('This function is only exportable when NODE_ENV === test for unit test purposes'));
}
exports.throwTestError = throwTestError;

/**
 * Generate a [40 character] random string
 *
 * @param {number} numBytes - number of bytes to use in creating a random string
 *                 defaults to 20 to produce a 40 character string
 * @returns {string} - a random string
 */
exports.randomString = (numBytes = 20) => crypto.randomBytes(numBytes).toString('hex');


/**
 * Postpend a [10-character] random string to input identifier.
 *
 * @param {string} id - identifer to return
 * @param {number} numBytes - number of bytes to use to compute random
 *                 extension. Default 5 to produce 10 characters..
 * @returns {string} - a random string
 */
exports.randomId = (id, numBytes = 5) => `${id}${exports.randomString(numBytes)}`;

/**
 * Create a random granule id from the regular expression
 *
 * @param {string} regex - regular expression string
 * @returns {string} - random granule id
 */
exports.randomStringFromRegex = (regex) => new RandExp(regex).gen();

// From https://github.com/localstack/localstack/blob/master/README.md
const localStackPorts = {
  stepfunctions: 10000, // add a fake port to support test overrides
  apigateway: 4567,
  cloudformation: 4581,
  cloudwatch: 4582,
  cloudwatchevents: 4582,
  dynamodb: 4569,
  dynamodbstreams: 4570,
  es: 4571,
  firehose: 4573,
  kinesis: 4568,
  lambda: 4574,
  redshift: 4577,
  route53: 4580,
  s3: 4572,
  ses: 4579,
  sns: 4575,
  sqs: 4576,
  ssm: 4583
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

  const localStackOptions = Object.assign({}, options, {
    accessKeyId: 'my-access-key-id',
    secretAccessKey: 'my-secret-access-key',
    region: 'us-east-1',
    endpoint: getLocalstackEndpoint(serviceIdentifier)
  });

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

/**
 * Validate an object using json-schema
 *
 * Issues a test failure if there were validation errors
 *
 * @param {Object} t - an ava test
 * @param {string} schemaFilename - the filename of the schema
 * @param {Object} data - the object to be validated
 * @returns {boolean} - whether the object is valid or not
 */
async function validateJSON(t, schemaFilename, data) {
  const schemaName = path.basename(schemaFilename).split('.')[0];
  const schema = await fs.readFile(schemaFilename, 'utf8').then(JSON.parse);
  const ajv = new Ajv();
  const valid = ajv.validate(schema, data);
  if (!valid) {
    const message = `${schemaName} validation failed: ${ajv.errorsText()}`;
    console.log(message);
    console.log(JSON.stringify(data, null, 2));
    t.fail(message);
    throw new Error(message);
  }
  return valid;
}

/**
 * Validate a task input object using json-schema
 *
 * Issues a test failure if there were validation errors
 *
 * @param {Object} t - an ava test
 * @param {Object} data - the object to be validated
 * @returns {boolean} - whether the object is valid or not
 */
async function validateInput(t, data) {
  return validateJSON(t, './schemas/input.json', data);
}
exports.validateInput = validateInput;

/**
 * Validate a task config object using json-schema
 *
 * Issues a test failure if there were validation errors
 *
 * @param {Object} t - an ava test
 * @param {Object} data - the object to be validated
 * @returns {boolean} - whether the object is valid or not
 */
async function validateConfig(t, data) {
  return validateJSON(t, './schemas/config.json', data);
}
exports.validateConfig = validateConfig;

/**
 * Validate a task output object using json-schema
 *
 * Issues a test failure if there were validation errors
 *
 * @param {Object} t - an ava test
 * @param {Object} data - the object to be validated
 * @returns {boolean} - whether the object is valid or not
 */
async function validateOutput(t, data) {
  return validateJSON(t, './schemas/output.json', data);
}
exports.validateOutput = validateOutput;

/**
 * Determine the path of the current git repo
 *
 * @param {string} dirname - the directory that you're trying to find the git
 *   root for
 * @returns {Promise.<string>} - the filesystem path of the current git repo
 */
async function findGitRepoRootDirectory(dirname) {
  if (await fs.pathExists(path.join(dirname, '.git'))) return dirname;

  // This indicates that we've reached the root of the filesystem
  if (path.dirname(dirname) === dirname) {
    throw new Error('Unable to determine git repo root directory');
  }

  return findGitRepoRootDirectory(path.dirname(dirname));
}
exports.findGitRepoRootDirectory = findGitRepoRootDirectory;

/**
 * Determine the path of the packages/test-data directory
 *
 * @returns {Promise.<string>} - the filesystem path of the packages/test-data directory
 */
function findTestDataDirectory() {
  return exports.findGitRepoRootDirectory(process.cwd())
    .then((gitRepoRoot) => path.join(gitRepoRoot, 'packages', 'test-data'));
}
exports.findTestDataDirectory = findTestDataDirectory;


function readJsonFixture(fixturePath) {
  return fs.readFile(fixturePath).then((obj) => JSON.parse(obj));
}

exports.readJsonFixture = readJsonFixture;

/**
 * Prettify and display something to the console.
 *
 * This is only intended to be used during debugging.
 *
 * @param {Object|Array} object - an object or array to be stringifyed
 * @returns {undefined} - no return value
 */
function jlog(object) {
  console.log(JSON.stringify(object, null, 2));
}
exports.jlog = jlog;

const throwThrottlingException = () => {
  const throttlingException = new Error('ThrottlingException');
  throttlingException.code = 'ThrottlingException';

  throw throttlingException;
};

/**
 * Return a function that throws a ThrottlingException the first time it is called, then returns as
 * normal any other times.
 *
 * @param {Function} fn
 * @returns {Function}
 */
exports.throttleOnce = (fn) => {
  let throttleNextCall = true;

  return (...args) => {
    if (throttleNextCall) {
      throttleNextCall = false;
      throwThrottlingException();
    }

    return fn(...args);
  };
};
