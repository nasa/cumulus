'use strict';

/**
 * check if segment is a regex segment
 *
 * @param {string} segment - path segment
 * @returns {boolean}
 */
const isRegexSegment = (segment) => segment.match(/(\([^\)]*\))/g) !== null;

/**
 * Insert leading and terminating slashes into the path string if not present
 *
 * @param {string} path - path string
 * @returns {string} normalized path
 */
const normalizeWithSlashes = (path) => {
  let output = path;
  if (!path.startsWith('/')) output = `/${output}`;
  if (!path.endsWith('/')) output = `${output}/`;
  return output;
};

/**
 * Recur on directory, list all files, and recur into any further directories,
 * as specified regex segments allow.
 * Note that the list function will be called with a path argument that includes
 * both leading and terminating slashes. List functions will need to be able to handle
 * or remove leading and terminating slashes accordingly.
 *
 * @param {Function} fn - list function
 * @param {string} currentPath - current path to list
 * @param {Array<string>} segments - path segments
 * @param {number} position - current position in the segment list
 */
async function recurOnDirectory(fn, currentPath, segments, position) {
  // check if we have a filter regex segment (e.g. '(dir.*)')
  const filterExpr = segments[position + 1] || '';
  const isRegex = isRegexSegment(filterExpr);

  const path = currentPath.replace(/\/+/g, '/');
  const contents = fn(path);
  let files = [];

  for (let ctr = 0; ctr < contents.length; ctr += 1) {
    const item = contents[ctr];
    if (['-', 0].includes(item.type)) {
      if (!isRegex || item.name.match(new RegExp(filterExpr))) {
        // add file to the list if it matches rule
        files.push(item);
      }
    } else if (['d', 1].includes(item.type)) {
      // check if dir matches rule
      if (!isRegex || item.name.match(new RegExp(filterExpr))) {
        // eslint-disable-next-line no-await-in-loop
        files = files.concat(await recurOnDirectory(fn, `${path}/${item.name}/`, segments, position + 1));
      }
    }
  }
  return files;
}

/**
 * Recursively list contents of a directory, filtering on provided regex segments.
 *
 * @param {Function} fn - list function
 * @param {string} path - path string which may contain regexes for filtering
 */
async function dynamicRecursiveList(fn, path) {
  const dynamicRegex = /(\([^\)]*\))/g;
  const normalizedPath = normalizeWithSlashes(path);
  const segments = normalizedPath
    .split(dynamicRegex) // split into text path and regex segments
    .filter((i) => !!i); // filter out empty segments from split

  return recurOnDirectory(fn, segments[0], segments, 0);
}

/**
 * Handles recursion of a FTP/SFTP list operation
 * It requests a promisified list function that returns contents of
 * a directory on a server
 *
 * @param {function} fn The promisified function for listing a directory
 * @param {string} originalPath the full path to use for recursively listing the directory
 * @returns {Promise} the promise of an object that has the path is the key and
 *   list of files as values
 */
async function recursion(fn, originalPath) {
  return dynamicRecursiveList(fn, originalPath);
}

module.exports = recursion;
