/*'use strict';

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
 *
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
        const nextDir = (currentPath === '/' ? `/${item.name}` : `${currentPath}/${item.name}`);
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
 * @param {string} configuredPath - path string configured by operator, which may contain
 *                                  regexes for filtering
 * @returns {Promise} the promise of an object that has the path is the key and
 *   list of files as values
 *
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
}*/

'use strict';

const join = require('path').join;
const log = require('@cumulus/common/log');

/**
 * Handles recursion of a FTP/SFTP list operation
 * It requests a promisified list function that returns contents of
 * a directory on a server
 *
 * @param {function} fn The promisified function for listing a directory
 * @param {string} originalPath the full path to use for recursively listing the directory
 * @param {string} [currentPath=null] the current directory to list recursively
 * @param {number} [position=0] current position in the recursive tree
 * @returns {Promise} the promise of an object that has the path is the key and
 *   list of files as values
 */
async function recursion(fn, originalPath, currentPath = null, position = 0) {
  // build the recursion path object
  const regex = /(\(.*?\))/g;
  const rules = (originalPath || '/').split(regex).map((i) => i.replace(/\\\\/g, '\\'));
  const map = rules.map((r) => (r.match(regex) !== null));

  let files = [];
  let path = currentPath;
  if (!path) {
    path = rules[position];
  }

  log.info(`Listing ${path}`);

  // get list of current path
  const list = await fn(path);

  // loop try what is returned
  for (let ctr = 0; ctr < list.length; ctr += 1) {
    const item = list[ctr];

    let regexPath;
    let textPath;
    let newPath;

    // if directory is found, apply recursion logic
    if (item.type === 'd' || item.type === 1) {
      // first we check if the next segment of the provided path
      // is a regex rule
      const isRegex = map[position + 1];

      // if it is the regex rule, we use the rule to
      // decide whether to do more recursion
      if (isRegex) {
        regexPath = new RegExp(rules[position + 1]);
      } else {
        // if it is just a path, we use that segment and its children
        textPath = rules[position + 1];
      }

      //  if next segment is regex and matches the rule
      //  list
      if (isRegex && item.name.match(regexPath)) {
        newPath = join(path, item.name);
      } else if (textPath) {
        // if it is a regular path, use the path
        newPath = join(path, textPath);
      } else {
        // and ignore all cases that does't match this rule
        continue; // eslint-disable-line no-continue
      }

      // eslint-disable-next-line no-await-in-loop
      const tmp = await recursion(fn, originalPath, newPath, position + 1);
      files = files.concat(tmp);

      if (textPath) break;
    } else if (item.type === '-' || item.type === 0) {
      // add file to the list
      files = files.concat(item);
    }
  }

  return files;
}

module.exports = recursion;
