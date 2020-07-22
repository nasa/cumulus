/* this module is intended to be used for bootstraping
 * the cloudformation deployment of a DAAC.
 *
 * It helps:
 *  - adding ElasticSearch index mapping when a new index is created
 */

'use strict';

const get = require('lodash/get');
const log = require('@cumulus/common/log');
const pLimit = require('p-limit');
const { inTestMode } = require('@cumulus/common/test-utils');
const { Search } = require('../es/search');
const esTypes = require('../es/types');
const { createIndex } = require('../es/indexer');

/**
 * Check the index to see if mappings have been updated since the index was last updated.
 * Return any types that are missing or have missing fields from the mapping.
 *
 * @param {Object} esClient - elasticsearch client instance
 * @param {string} index - index name (cannot be alias)
 * @param {string} type - type name
 * @returns {Array<string>} - list of missing indices
 */
async function findMissingMappings(esClient, index, type) {
  const newMappings = esTypes.getMappingsByType(type);

  const typesResponse = await esClient.indices.getMapping({
    index
  }).then((response) => response.body);

  const types = Object.keys(newMappings);
  const indexMappings = get(typesResponse, `${index}.mappings`);

  return types.filter((t) => {
    const oldMapping = indexMappings[t];
    if (!oldMapping) return true;
    const newMapping = newMappings[t];
    // Check for new dynamic templates and properties
    if (newMapping.dynamic_templates
      && (
        !oldMapping.dynamic_templates
        || (newMapping.dynamic_templates.length > oldMapping.dynamic_templates.length)
      )
    ) {
      return true;
    }
    const fields = Object.keys(newMapping.properties);
    return !!fields.filter((field) => !Object.keys(oldMapping.properties).includes(field)).length;
  });
}

async function bootstrapElasticsearchIndex(
  esClient,
  type,
  aliasOverride = undefined,
  indexOverride = undefined
) {
  const alias = esTypes.getAliasByType(type, aliasOverride);

  let indexName = esTypes.getIndexNameForType(indexOverride, type);
  let indexIsAliased = false;

  // If the alias already exists as an index, remove it
  // We can't do a simple exists check here, because it'll return true if the alias
  // is actually an alias assigned to an index. We do a get and check that the alias
  // name is not the key, which would indicate it's an index
  const { body: existingIndex } = await esClient.indices.get(
    { index: alias },
    { ignore: [404] }
  );

  if (existingIndex && !existingIndex.error) {
    if (existingIndex[alias]) {
      log.info(`Deleting alias as index: ${alias}`);
      await esClient.indices.delete({ index: alias });
      delete existingIndex[alias];
    }

    if (indexName && existingIndex[indexName]) {
      indexIsAliased = true;
    } else if (!indexOverride) {
      const existingIndices = Object.keys(existingIndex);

      if (existingIndices.length >= 1) {
        indexName = existingIndices[0];
        indexIsAliased = true;
      }
    }
  }

  const indexExists = indexIsAliased
    || await esClient.indices.exists({ index: indexName }).then((response) => response.body);

  if (!indexExists) { // the index does not exist so create it
    await createIndex(esClient, type, indexName);
    log.info(`Created index ${indexName}`);
    await esClient.indices.putAlias({
      index: indexName,
      name: alias
    });
    log.info(`Created alias ${alias} for index ${indexName}`);
  } else if (!indexIsAliased) {
    // check that it has the alias on it
    log.info(`index ${indexName} already exists`);

    const aliasExists = await esClient.indices.existsAlias({
      name: alias
    }).then((response) => response.body);

    if (!aliasExists) {
      await esClient.indices.putAlias({
        index: indexName,
        name: alias
      });

      log.info(`Created alias ${alias} for index ${indexName}`);
    }
  }

  const missingTypes = await findMissingMappings(esClient, indexName, type);
  const mappings = esTypes.getMappingsByType(type);

  if (missingTypes.length > 0) {
    log.info(`Updating mappings for ${missingTypes}`);
    const concurrencyLimit = inTestMode() ? 1 : 3;
    const limit = pLimit(concurrencyLimit);
    const addMissingTypesPromises = missingTypes.map((t) =>
      limit(() => esClient.indices.putMapping({
        index: indexName,
        type: t,
        body: get(mappings, t)
      })));

    await Promise.all(addMissingTypesPromises);

    log.info(`Added missing types to index ${indexName}: ${missingTypes}`);
  }
}

/**
 * Initialize elastic search. If the index does not exist, create it with an alias.
 * If an index exists but is not aliased, alias the index.
 *
 * @param {string} host - elastic search host
 * @param {string} indexOverride - name of the index to create if does not exist
 * @param {string} aliasOverride - alias name for the index, defaults to 'cumulus'
 * @returns {Promise} undefined
 */
async function bootstrapElasticSearch(host, indexOverride = undefined, aliasOverride = undefined) {
  if (!host) return;

  const esClient = await Search.es(host);

  // Make sure that indexes are not automatically created
  await esClient.cluster.putSettings({
    body: {
      persistent: { 'action.auto_create_index': false }
    }
  });

  const types = esTypes.getEsTypes();
  await Promise.all(types.map((esType) =>
    bootstrapElasticsearchIndex(esClient, esType, aliasOverride, indexOverride)));
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
  } catch (error) {
    log.error(error);
    return { Status: 'FAILED', Error: error };
  }
};

module.exports = {
  handler,
  bootstrapElasticSearch
};
