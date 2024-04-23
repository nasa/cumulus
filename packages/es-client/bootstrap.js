/* this module is intended to be used for bootstraping
 * the cloudformation deployment of a DAAC.
 *
 * It helps:
 *  - adding ElasticSearch index mapping when a new index is created
 */

'use strict';

const get = require('lodash/get');
const isNil = require('lodash/isNil');
const pLimit = require('p-limit');

const Logger = require('@cumulus/logger');
const { inTestMode } = require('@cumulus/common/test-utils');
const { IndexExistsError } = require('@cumulus/errors');

const { EsClient, defaultIndexAlias } = require('./search');
const { createIndex } = require('./indexer');
const mappings = require('./config/mappings.json');

const logger = new Logger({ sender: '@cumulus/es-client/bootstrap' });

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
  const typesResponse = await esClient.client.indices.getMapping({
    index,
  }).then((response) => response.body);

  const types = Object.keys(newMappings);
  const indexMappings = get(typesResponse, `${index}.mappings`);

  return types.filter((type) => {
    const oldMapping = indexMappings[type];
    if (!oldMapping) return true;
    const newMapping = newMappings[type];
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

async function removeIndexAsAlias(esClient, alias, removeAliasConflict) {
  // If the alias already exists as an index, remove it
  // We can't do a simple exists check here, because it'll return true if the alias
  // is actually an alias assigned to an index. We do a get and check that the alias
  // name is not the key, which would indicate it's an index
  const { body: existingIndex } = await esClient.client.indices.get(
    { index: alias },
    { ignore: [404] }
  );

  if (existingIndex && existingIndex[alias]) {
    logger.warn(`Conflicting index for alias ${alias} detected!`);
    if (!removeAliasConflict) {
      throw new Error('Aborting ES recreation as configuration does not allow removal of index');
    }
    logger.warn(`Deleting alias as index: ${alias}`);
    await esClient.client.indices.delete({ index: alias });
  }
}

/**
 * Initialize elastic search. If the index does not exist, create it with an alias.
 * If an index exists but is not aliased, alias the index.
 *
 * @param {Object} params
 * @param {string} params.host                 - elastic search host
 * @param {string} params.index                - name of the index to create if does not exist,
 *                                               defaults to 'cumulus'
 * @param {string} params.alias                - alias name for the index, defaults to 'cumulus'
 * @param {boolean} params.removeAliasConflict - Flag to allow/disallow deletion of conflicting
 *                                               'cumulus-alias' index
 * @returns {Promise} undefined
 */
async function bootstrapElasticSearch({
  host,
  index = 'cumulus',
  alias = defaultIndexAlias,
  removeAliasConflict = true,
}) {
  if (!host) return;

  const esClient = new EsClient(host);
  await esClient.initializeEsClient();

  // Make sure that indexes are not automatically created
  await esClient.client.cluster.putSettings({
    body: {
      persistent: { 'action.auto_create_index': false },
    },
  });

  await removeIndexAsAlias(esClient, alias, removeAliasConflict);

  let aliasedIndex = index;

  const indices = await esClient.client.indices.getAlias({ name: alias }, { ignore: [404] })
    .then((response) => response.body);

  const aliasExists = !isNil(indices) && !indices.error;

  if (aliasExists) {
    aliasedIndex = Object.keys(indices)[0];

    if (indices.length > 1) {
      logger.info(`Multiple indices found for alias ${alias}, using index ${aliasedIndex}.`);
    }
  } else {
    try {
      await createIndex(esClient, index);
    } catch (error) {
      if (!(error instanceof IndexExistsError)) {
        throw error;
      }
    }

    await esClient.client.indices.putAlias({
      index: index,
      name: alias,
    });

    logger.info(`Created alias ${alias} for index ${index}`);
  }

  const missingTypes = await findMissingMappings(esClient, aliasedIndex, mappings);

  if (missingTypes.length > 0) {
    logger.info(`Updating mappings for ${missingTypes}`);
    const concurrencyLimit = inTestMode() ? 1 : 3;
    const limit = pLimit(concurrencyLimit);
    const addMissingTypesPromises = missingTypes.map((type) =>
      limit(() => esClient.client.indices.putMapping({
        index: aliasedIndex,
        type,
        body: get(mappings, type),
      })));

    await Promise.all(addMissingTypesPromises);

    logger.info(`Added missing types to index ${aliasedIndex}: ${missingTypes}`);
  }
}

module.exports = {
  bootstrapElasticSearch,
  // for testing
  findMissingMappings,
};
