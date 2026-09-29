'use strict';

const router = require('express-promise-router')();

const { getParameterValue } = require('@cumulus/aws-client/SSM');
const Logger = require('@cumulus/logger');

const log = new Logger({ sender: '@cumulus/api/instance-meta' });

/**
 * Get the list of iceberg admin usernames from the SSM parameter created by the
 * rds-iceberg-replication module (`${prefix}-iceberg_admins_list`).
 *
 * The list is informational, so a failure to read it (e.g. the parameter doesn't exist because
 * iceberg replication isn't deployed for this stack) results in an empty list rather than
 * failing the whole request.
 *
 * @returns {Promise<Array<string>>} the iceberg admin usernames
 */
async function getIcebergAdmins() {
  const parameterName = `${process.env.stackName}-iceberg_admins_list`;
  try {
    const value = await getParameterValue(parameterName);
    if (!value) return [];
    return value.split(',').map((admin) => admin.trim()).filter((admin) => admin);
  } catch (error) {
    if (error.name === 'ParameterNotFound') {
      log.info(`SSM parameter ${parameterName} not found, returning no iceberg admins`);
    } else {
      log.error(`Failed to read SSM parameter ${parameterName}`, error);
    }
    return [];
  }
}

/**
 * returns information about the cumulus instance
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the express response object with instance meta info
 */
async function instanceMetadata(req, res) {
  return res.send({
    cmr: {
      provider: process.env.cmr_provider,
      environment: process.env.CMR_ENVIRONMENT || 'UAT',
      oauth_provider: process.env.cmr_oauth_provider || '',
    },
    cumulus: {
      stackName: process.env.stackName,
    },
    icebergAdmins: await getIcebergAdmins(),
  });
}

router.get('/', instanceMetadata);

module.exports = router;
