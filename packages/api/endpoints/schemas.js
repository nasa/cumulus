'use strict';

const router = require('express-promise-router')();
const schemas = require('../models/schemas');

/**
 * get a particular schema
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const schemaName = req.params.name;

  return await res.send(schemas[schemaName]);
}

router.get('/:name', get);

module.exports = router;
