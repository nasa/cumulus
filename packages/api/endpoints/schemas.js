'use strict';

const router = require('express-promise-router')();
const schemas = require('../lib/schemas');

/**
 * get a particular schema
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
function get(req, res) {
  const schemaName = req.params.name;

  return res.send(schemas[schemaName]);
}

router.get('/:name', get);

module.exports = router;
