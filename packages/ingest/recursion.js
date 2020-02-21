'use strict';

const path = require('path');
const log = require('@cumulus/common/log');

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
        const nextDir = path.normalize(`${currentPath}/${item.name}`);
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
 * Note that calls to the list function will use either a relative or absolute path, corresponding
 * to the `configuredPath` passed into this function. The list function will initially be called
 * with '.' for a relative path or '/' for an absolute path. List functions will need to be able to
 * normalize or correct these paths as appropriate for their protocol.
 *
 * Further calls to the list functions will append the current path to that starting path, such
 * that all calls will start with either '.' or '/', regardless of additional characters, e.g.
 * `fn('./path')` vs. `fn('path')`.
 *
 * In the case of failure during the recursive list, this function will only apply `path.normalize`
 * to the `configuredPath` and then call the list function with the entire normalizedPath.
 *
 * @param {function} fn - the promisified function for listing a directory
 * @param {string} configuredPath - path string configured by operator, which may contain
 *                                  regexes for filtering
 * @returns {Promise} the promise of an object that has the path is the key and
 *   list of files as values
 */
async function recursion(fn, configuredPath) {
  const normalizedPath = path.normalize(configuredPath);
  const isAbsolutePath = path.isAbsolute(normalizedPath);
  try {
    const segments = normalizedPath
      .split('/') // split on divider
      .filter((segment) => segment.trim() !== ''); // filter out empty strings from split
    const startingPath = isAbsolutePath ? '/' : '.';
    return await recurOnDirectory(fn, startingPath, segments, -1);
  } catch (e) {
    log.error(`Encountered error during recursive list filtering: ${e}`);
    log.info('Falling back to unfiltered directory listing...');
    return recurOnDirectory(fn, normalizedPath, [], 0);
  }
}

module.exports = recursion;
