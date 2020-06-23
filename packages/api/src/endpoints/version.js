'use strict';

const router = require('express-promise-router')();
const pckg = require('../package.json');

/**
 * get the API response and package versions
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Object} API response and package versions
 */
function get(req, res) {
  return res.send({
    response_version: 'v1',
    api_version: pckg.version
  });
}

router.get('/', get);

module.exports = router;
