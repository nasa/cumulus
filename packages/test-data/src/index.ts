import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);

const testDataPath = (name: string): string =>
  path.join(__dirname, '..', name);

/**
 * Read test data in as a string
 *
 * @param {string} name - the path to the test data
 * @returns {Promise<string>} the test data as a string
 */
export const loadTestData = (name: string): Promise<string> => {
  const filePath = testDataPath(name);
  return readFile(filePath, 'utf8');
};

/**
 * Read and parse JSON-formatted test data
 *
 * @param {string} name - the path to the test data
 * @returns {Promise<unknown>} the test data parsed into Javascript
 */
export const loadJSONTestData = (name: string): Promise<unknown> =>
  loadTestData(name).then(JSON.parse);

/**
 * Get a stream containing test data
 *
 * @param {string} name - the path to the test data
 * @returns {Stream} the test data as a writable stream
 */
export const streamTestData = (name: string): fs.ReadStream => {
  const filePath = testDataPath(name);
  return fs.createReadStream(filePath);
};
