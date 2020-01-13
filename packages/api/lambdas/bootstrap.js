/* this module is intended to be used for bootstraping
 * the cloudformation deployment of a DAAC.
 *
 * It helps:
 *  - adding ElasticSearch index mapping when a new index is created
 */

'use strict';

const get = require('lodash.get');
const log = require('@cumulus/common/log');
const pLimit = require('p-limit');
const { inTestMode } = require('@cumulus/common/test-utils');
const { Search, defaultIndexAlias } = require('../es/search');
const mappings = require('../models/mappings.json');

/**
 * Check the index to see if mappings have been updated since the index was last updated.
 * Return any types that are missing or have missing fields from the mapping.
 *
 * @param {Object} esClient - elasticsearch client instance
 * @param {string} index - index name (cannot be alias)
 * @param {Array<Object>} newMappings - list of mappings to check against
 * @returns {Array<string>} - list of missing indices
 */
async function findMissingMappings(esClient, index, newMappings) {
  const typesResponse = await esClient.indices.getMapping({
    index
  }).then((response) => response.body);

  const types = Object.keys(newMappings);
  const indexMappings = get(typesResponse, `${index}.mappings`);

  return types.filter((type) => {
    const oldMapping = indexMappings[type];
    if (!oldMapping) return true;
    const newMapping = newMappings[type];
    // Check for new dynamic templates and properties
    if (newMapping.dynamic_templates && (!oldMapping.dynamic_templates
       || newMapping.dynamic_templates.length
       > oldMapping.dynamic_templates.length)) {
      return true;
    }
    const fields = Object.keys(newMapping.properties);
    return !!fields.filter((field) => !Object.keys(oldMapping.properties).includes(field)).length;
  });
}

/**
 * Initialize elastic search. If the index does not exist, create it with an alias.
 * If an index exists but is not aliased, alias the index.
 *
 * @param {string} host - elastic search host
 * @param {string} index - name of the index to create if does not exist, defaults to 'cumulus'
 * @param {string} alias - alias name for the index, defaults to 'cumulus'
 * @returns {Promise} undefined
 */
async function bootstrapElasticSearch(host, index = 'cumulus', alias = defaultIndexAlias) {
  if (!host) return;

  const esClient = await Search.es(host);

  // Make sure that indexes are not automatically created
  await esClient.cluster.putSettings({
    body: {
      persistent: { 'action.auto_create_index': false }
    }
  });

  // If the alias already exists as an index, remove it
  // We can't do a simple exists check here, because it'll return true if the alias
  // is actually an alias assigned to an index. We do a get and check that the alias
  // name is not the key, which would indicate it's an index
  const { body: existingIndex } = await esClient.indices.get(
    { index: alias },
    { ignore: [404] }
  );
  if (existingIndex && existingIndex[alias]) {
    log.info(`Deleting alias as index: ${alias}`);
    await esClient.indices.delete({ index: alias });
  }

  // check if the index exists
  const exists = await esClient.indices.exists({ index })
    .then((response) => response.body);

  if (!exists) {
    // add mapping
    await esClient.indices.create({
      index,
      body: { mappings }
    });

    await esClient.indices.putAlias({
      index: index,
      name: alias
    });

    log.info(`index ${index} created with alias ${alias} and mappings added.`);
  } else {
    log.info(`index ${index} already exists`);

    let aliasedIndex = index;

    const aliasExists = await esClient.indices.existsAlias({
      name: alias
    }).then((response) => response.body);

    if (!aliasExists) {
      await esClient.indices.putAlias({
        index: index,
        name: alias
      });

      log.info(`Created alias ${alias} for index ${index}`);
    } else {
      const indices = await esClient.indices.getAlias({ name: alias })
        .then((response) => response.body);

      aliasedIndex = Object.keys(indices)[0];

      if (indices.length > 1) {
        log.info(`Multiple indices found for alias ${alias}, using index ${aliasedIndex}.`);
      }
    }

    const missingTypes = await findMissingMappings(esClient, aliasedIndex, mappings);

    if (missingTypes.length > 0) {
      log.info(`Updating mappings for ${missingTypes}`);
      const concurrencyLimit = inTestMode() ? 1 : 3;
      const limit = pLimit(concurrencyLimit);
      const addMissingTypesPromises = missingTypes.map((type) =>
        limit(() => esClient.indices.putMapping({
          index: aliasedIndex,
          type,
          body: get(mappings, type)
        })));

      await Promise.all(addMissingTypesPromises);

      log.info(`Added missing types to index ${aliasedIndex}: ${missingTypes}`);
    }
  }
}

/**
 * Bootstrap Elasticsearch indexes
 *
 * @param {Object} event - AWS Lambda event input
 * @returns {Promise<Object>} a Terraform Lambda invocation response
 */
const handler = async ({ elasticsearchHostname }) => {
  try {
    await bootstrapElasticSearch(elasticsearchHostname);
    return { Status: 'SUCCESS', Data: {} };
  } catch (err) {
    return { Status: 'FAILED', Error: err };
  }
};

module.exports = {
  handler,
  bootstrapElasticSearch,
  // for testing
  findMissingMappings
};
