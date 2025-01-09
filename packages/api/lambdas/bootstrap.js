/* this module is intended to be used for bootstraping
 * the cloudformation deployment of a DAAC.
 *
 * It helps:
 *  - adding ElasticSearch index mapping when a new index is created
 */
// is this needed for CloudMetrics?
'use strict';

const log = require('@cumulus/common/log');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');

/**
 * Bootstrap Elasticsearch indexes
 *
 * @param {Object} event - AWS Lambda event input
 * @returns {Promise<Object>} a Terraform Lambda invocation response
 */
const handler = async ({ elasticsearchHostname, removeAliasConflict, testContext = {} }) => {
  const bootstrapFunction = testContext.bootstrapFunction || bootstrapElasticSearch;
  try {
    await bootstrapFunction({
      host: elasticsearchHostname,
      removeAliasConflict,
    });
    return { Status: 'SUCCESS', Data: {} };
  } catch (error) {
    log.error(error);
    throw error;
  }
};

module.exports = {
  handler,
};
