'use strict';

const path = require('path');
const pkgDir = require('pkg-dir');
const router = require('express-promise-router')();
const { readJsonSync } = require('fs-extra');

/**
 * get the API response and package versions
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Object} API response and package versions
 */
function get(req, res) {
  const thisPackageDir = pkgDir.sync(__dirname);
  const packageJson = readJsonSync(path.join(thisPackageDir, 'package.json'));

  return res.send({
    response_version: 'v1',
    api_version: packageJson.version
  });
}

router.get('/', get);

module.exports = router;
