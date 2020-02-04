'use strict';

const log = require('@cumulus/common/log');

/**
 * Insert leading and remove terminating slashes into/from the path string
 *
 * @param {string} path - path string
 * @returns {string} normalized path
 */
const normalizeSlashes = (path) => {
  let output = path.replace(/[\/]{2,}/g, '/');
  if (!output.startsWith('/')) output = `/${output}`;
  if (output.endsWith('/')) output = output.slice(0, -1);
  return output;
};

/**
 * Recur on directory, list all files, and recur into any further directories,
 * as specified regex segments allow.
 *
 * @param {Function} fn - list function
 * @param {string} currentPath - current path to list
 * @param {Array<string>} segments - path segments
 * @param {number} position - current position in the segment list
 * @returns {Array<Object>} - filtered contents of directory
 */
async function recurOnDirectory(fn, currentPath, segments, position) {
  // interpret the next path segment as a regex for filtering, and
  // recursively list everything when we've run out of segments
  const filterExpr = segments[position + 1] || '.*';
  const filterRegex = new RegExp(filterExpr);
  const contents = await fn(currentPath);
  let files = [];

  for (let ctr = 0; ctr < contents.length; ctr += 1) {
    const item = contents[ctr];
    // check if item passes filter
    if (filterRegex.test(item.name)) {
      if (['-', 0].includes(item.type)) {
        files.push(item);
      } else if (['d', 1].includes(item.type)) {
        const nextDir = (currentPath === '' ? item.name : `${currentPath}/${item.name}`);
        // eslint-disable-next-line no-await-in-loop
        files = files.concat(await recurOnDirectory(fn, nextDir, segments, position + 1));
      }
    }
  }
  return files;
}

/**
 * Handles recursion of a FTP/SFTP list operation
 * It requests a promisified list function that returns contents of
 * a directory on a server, filtering on provided regex segments.
 *
 * Note that calls to the list function will not have leading or terminating slashes.
 * Initially an empty string is passed as the path to list the default directory. Following calls
 * based on items discovered will be of the format `fn('path/to/files')`, again with no leading or
 * terminating slashes.
 *
 * List functions will need to be able to normalize or correct these paths as appropriate for their
 * protocol.
 *
 * @param {function} fn - the promisified function for listing a directory
 * @param {string} originalPath - path string which may contain regexes for filtering
 * @returns {Promise} the promise of an object that has the path is the key and
 *   list of files as values
 */
async function recursion(fn, originalPath) {
  const normalizedPath = normalizeSlashes(originalPath);
  try {
    const segments = normalizedPath.split('/'); // split on divider
    return await recurOnDirectory(fn, segments[0], segments, 0);
  } catch (e) {
    log.error(`Encountered error during recursive list filtering: ${e}`);
    log.info('Falling back to unfiltered directory listing...');
    return recurOnDirectory(fn, normalizedPath.slice(1), [], 0);
  }
}

module.exports = recursion;
