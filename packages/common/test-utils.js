/* eslint-disable no-console */

'use strict';

const Ajv = require('ajv');
const crypto = require('crypto');
const path = require('path');
const formidable = require('formidable');
const fs = require('fs-extra');
const http = require('http');
const { URL } = require('url');

exports.inTestMode = () => process.env.NODE_ENV === 'test';

/**
 * Generate a 40-character random string
 *
 * @returns {string} - a random string
 */
exports.randomString = () => crypto.randomBytes(20).toString('hex');

// From https://github.com/localstack/localstack/blob/master/README.md
const localStackPorts = {
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
  return Object.keys(localStackPorts).indexOf(serviceIdentifier) !== -1;
}

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
    endpoint: `http://${process.env.LOCALSTACK_HOST}:${localStackPorts[serviceIdentifier]}`
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
  if (localstackSupportedService(Service)) {
    return localStackAwsClient(Service, options);
  }
  return new Service(Object.assign(options, { endpoint: 'http://you-forgot-to-stub-an-aws-call' }));
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

// This class runs a simulted Earthdata Login server
class FakeEarthdataLoginServer extends http.Server {
  constructor() {
    super();

    this.usernamesByCode = {};

    this.on('request', (request, response) => {
      const requestUrl = new URL(request.url, this.endpoint);

      if (request.method === 'POST' && requestUrl.pathname === '/oauth/token') {
        this.handleAccessTokenRequest(request, response);
      }
      else {
        response.statusCode = 404;
        response.end();
      }
    });
  }

  /**
   * Create an authorization code for the given user.
   *
   * This is the code that's returned after the user successfully authenticates
   * against the Earthdata Login service and is redirected back to Cumulus.
   *
   * @param {string} username - username to create the code for
   * @returns {string} the authorization code
   */
  createAuthorizationCodeForUser(username) {
    const code = exports.randomString();
    this.usernamesByCode[code] = username;
    return code;
  }

  /**
   * Start the fake Onearth Login server on a random port
   *
   * @param {function} cb - The callback that's called when the server is listening
   * @returns {undefined} no return value
   */
  listen(cb) {
    super.listen(0, '0.0.0.0', cb);
  }

  /**
   * Get the URL where the fake Earthdata Login service is listening
   *
   * @returns {string} - a URL
   * @readonly
   * @memberof FakeEarthdataLoginServer
   */
  get endpoint() {
    const { address, port } = this.address();
    return `http://${address}:${port}`;
  }

  // @private
  handleAccessTokenRequest(request, response) {
    const form = new formidable.IncomingForm();
    form.parse(request, (err, fields) => {
      if (!fields.code) {
        response.statusCode = 400;
        return response.end(JSON.stringify({ error: '"code" not set' }));
      }

      const username = this.usernamesByCode[fields.code];
      if (!username) {
        response.statusCode = 404;
        return response.end(JSON.stringify({ error: `No user found for code ${fields.code}` }));
      }

      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({
        access_token: 'abc123',
        token_type: 'Bearer',
        expires_in: 123,
        refresh_token: 'asdf1234',
        endpoint: `/api/users/${username}`
      }));
    });
  }
}
exports.FakeEarthdataLoginServer = FakeEarthdataLoginServer;
