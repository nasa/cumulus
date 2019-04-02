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
      }
      // if it is just a path, we use that segment and its children
      else {
        textPath = rules[position + 1];
      }

      //  if next segment is regex and matches the rule
      //  list
      if (isRegex && item.name.match(regexPath)) {
        newPath = join(path, item.name);
      }
      // if it is a regular path, use the path
      else if (textPath) {
        newPath = join(path, textPath);
      }
      // and ignore all cases that does't match this rule
      else {
        continue; // eslint-disable-line no-continue
      }

      // eslint-disable-next-line no-await-in-loop
      const tmp = await recursion(fn, originalPath, newPath, position + 1);
      files = files.concat(tmp);

      if (textPath) break;
    }
    // add file to the list
    else if (item.type === '-' || item.type === 0) {
      files = files.concat(item);
    }
  }

  return files;
}

module.exports = recursion;
