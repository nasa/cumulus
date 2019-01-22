'use strict';

const router = require('express-promise-router')();

/**
 * returns information about the cumulus instance
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Object} the express response object with instance meta info
 */
function instanceMetadata(req, res) {
  return res.send({
    cmr: {
      provider: process.env.cmr_provider,
      environment: process.env.CMR_ENVIRONMENT || 'UAT'
    }
  });
}

router.get('/', instanceMetadata);

module.exports = router;
