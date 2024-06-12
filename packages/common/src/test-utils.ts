/* eslint no-console: "off" */

import Ajv from 'ajv';
import crypto from 'crypto';
import path from 'path';
import RandExp from 'randexp';
import fs from 'fs-extra';
import { ExecutionContext } from 'ava';

export { readJsonFile as readJsonFixture } from './FileUtils';

export const inTestMode = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.NODE_ENV === 'test';

/**
 * Helper function to throw error for unit test exports
 * 
 * @throws {Error}
 */
export const throwTestError = () => {
  throw new Error('This function is only exportable when NODE_ENV === test for unit test purposes');
};

/**
 * Generate a [40 character] random string
 *
 * @param {number} numBytes - number of bytes to use in creating a random string
 *                 defaults to 20 to produce a 40 character string
 * @returns {string} - a random string
 */
export const randomString = (numBytes = 20) =>
  crypto.randomBytes(numBytes).toString('hex');

/**
 * Postpend a [10-character] random string to input identifier.
 *
 * @param {string} id - identifer to return
 * @param {number} numBytes - number of bytes to use to compute random
 *                 extension. Default 5 to produce 10 characters..
 * @returns {string} - a random string
 */
export const randomId = (id: string, numBytes = 5) =>
  `${id}${exports.randomString(numBytes)}`;

/**
 * Generate a random for the given scale.
 *
 * Defaults to a number between 1 and 10.
 *
 * @param {number} scale - scale for the random number. Defaults to 10.
 * @returns {number} - a random number
 */
export const randomNumber = (scale = 10) => Math.ceil(Math.random() * scale);

/**
 * Create a random granule id from the regular expression
 *
 * @param {string} regex - regular expression string
 * @returns {string} - random granule id
 */
export const randomStringFromRegex = (regex: string) =>
  new RandExp(regex).gen();

/**
 * Validate an object using json-schema
 *
 * Issues a test failure if there were validation errors
 *
 * @param {Object} t - an ava test
 * @param {string} schemaFilename - the filename of the schema
 * @param {Object} data - the object to be validated
 * @returns {Promise<undefined>}
 */
async function validateJSON(
  t: ExecutionContext,
  schemaFilename: string,
  data: unknown
) {
  const schemaName = path.basename(schemaFilename).split('.')[0];
  const schema = await fs.readFile(schemaFilename, 'utf8').then(JSON.parse);
  const ajv = new Ajv();
  const valid = <boolean>ajv.validate(schema, data);
  if (!valid) {
    const message = `${schemaName} validation failed: ${ajv.errorsText()}`;
    console.log(message);
    console.log(JSON.stringify(data, undefined, 2));
    t.fail(message);
    throw new Error(message);
  }
}

/**
 * Validate a task input object using json-schema
 *
 * Issues a test failure if there were validation errors
 *
 * @param {Object} t - an ava test
 * @param {Object} data - the object to be validated
 * @returns {Promise<undefined>}
 */
export async function validateInput(t: ExecutionContext, data: unknown) {
  await validateJSON(t, './schemas/input.json', data);
}

/**
 * Validate a task config object using json-schema
 *
 * Issues a test failure if there were validation errors
 *
 * @param {Object} t - an ava test
 * @param {Object} data - the object to be validated
 * @returns {Promise<undefined>}
 */
export async function validateConfig(t: ExecutionContext, data: unknown) {
  await validateJSON(t, './schemas/config.json', data);
}

/**
 * Validate a task output object using json-schema
 *
 * Issues a test failure if there were validation errors
 *
 * @param {Object} t - an ava test
 * @param {Object} data - the object to be validated
 * @returns {Promise<undefined>}
 */
export async function validateOutput(t: ExecutionContext, data: unknown) {
  await validateJSON(t, './schemas/output.json', data);
}

/**
 * Determine the path of the current git repo
 *
 * @param {string} dirname - the directory that you're trying to find the git
 *   root for
 * @returns {Promise.<string>} - the filesystem path of the current git repo
 */
export async function findGitRepoRootDirectory(
  dirname: string
): Promise<string> {
  if (await fs.pathExists(path.join(dirname, '.git'))) return dirname;

  // This indicates that we've reached the root of the filesystem
  if (path.dirname(dirname) === dirname) {
    throw new Error('Unable to determine git repo root directory');
  }

  return findGitRepoRootDirectory(path.dirname(dirname));
}

/**
 * Determine the path of the packages/test-data directory
 *
 * @returns {Promise.<string>} - the filesystem path of the packages/test-data
 *   directory
 */
export function findTestDataDirectory() {
  return findGitRepoRootDirectory(process.cwd())
    .then((gitRepoRoot) => path.join(gitRepoRoot, 'packages', 'test-data'));
}

/**
 * Prettify and display something to the console.
 *
 * This is only intended to be used during debugging.
 *
 * @param {Object|Array} object - an object or array to be stringifyed
 * @returns {undefined} - no return value
 */
export function jlog(object: unknown) {
  console.log(JSON.stringify(object, undefined, 2));
}
