/* eslint no-console: "off" */

'use strict';

const Ajv = require('ajv');
const crypto = require('crypto');
const path = require('path');
const RandExp = require('randexp');
const fs = require('fs-extra');

const testUtils = require('@cumulus/aws-client/test-utils');
const { deprecate } = require('./util');

exports.inTestMode = () => {
  deprecate('@cumulus/common/test-utils/inTestMode', '1.17.0', '@cumulus/aws-client/test-utils/inTestMode');
  return testUtils.inTestMode();
};

exports.getLocalstackEndpoint = (identifier) => {
  deprecate('@cumulus/common/test-utils/getLocalstackEndpoint', '1.17.0', '@cumulus/aws-client/test-utils/getLocalstackEndpoint');
  return testUtils.getLocalstackEndpoint(identifier);
};

exports.testAwsClient = (Service, options) => {
  deprecate('@cumulus/common/test-utils/testAwsClient', '1.17.0', '@cumulus/aws-client/test-utils/testAwsClient');
  return testUtils.getLocalstackEndpoint(Service, options);
};

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
 * Generate a random for the given scale.
 *
 * Defaults to a number between 1 and 10.
 *
 * @param {number} scale - scale for the random number. Defaults to 10.
 * @returns {number} - a random number
 */
exports.randomNumber = (scale = 10) => Math.ceil(Math.random() * scale);

/**
 * Create a random granule id from the regular expression
 *
 * @param {string} regex - regular expression string
 * @returns {string} - random granule id
 */
exports.randomStringFromRegex = (regex) => new RandExp(regex).gen();

/**
 * Validate an object using json-schema
 *
 * Issues a test failure if there were validation errors
 *
 * @param {Object} t - an ava test
 * @param {string} schemaFilename - the filename of the schema
 * @param {Object} data - the object to be validated
 * @returns {Promise<boolean>} - whether the object is valid or not
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
 * @returns {Promise<boolean>} - whether the object is valid or not
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
 * @returns {Promise<boolean>} - whether the object is valid or not
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
