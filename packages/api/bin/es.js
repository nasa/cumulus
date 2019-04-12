'use strict';

const { Search, defaultIndexAlias } = require('../es/search');
const mappings = require('../models/mappings.json');

/**
 * Complete the Elasticsearch reindex by swapping the alias from source index to
 * dest index so that dest index will now be the index used by Cumulus
 *
 * @param {string} host - Elasticsearch host
 * @param {string} sourceIndex - name of the index to swap from
 * @param {string} destIndex - name of the index to swap to
 * @param {string} aliasName - alias name that the instance is using, defaults to cumulus-alias
 * @param {boolean} deleteSource - true to delete the source index
 * @returns {undefined} - none
 */
async function completeReindex(
  host,
  sourceIndex,
  destIndex,
  aliasName = defaultIndexAlias,
  deleteSource = false
) {
  const esClient = await Search.es(host);

  if (sourceIndex === null || destIndex === null) {
    throw new Error('Please explicity specify a source and destination index.');
  }

  if (sourceIndex === destIndex) {
    throw new Error('The source index cannot be the same as the destination index.');
  }

  const sourceExists = await esClient.indices.exists({ index: sourceIndex });

  if (!sourceExists) {
    throw new Error(`Source index ${sourceIndex} does not exist.`);
  }

  const destExists = await esClient.indices.exists({ index: destIndex });

  if (!destExists) {
    throw new Error(`Destination index ${destIndex} does not exist.`);
  }

  await esClient.indices.updateAliases({
    body: {
      actions: [
        { remove: { index: sourceIndex, alias: aliasName } },
        { add: { index: destIndex, alias: aliasName } }
      ]
    }
  }).then(() => {
    console.log(`Removed alias ${aliasName} from index ${sourceIndex} and added alias to ${destIndex}`);
  }, (err) => {
    throw new Error(`Error removing alias ${aliasName} from index ${sourceIndex} and adding alias to ${destIndex}: ${err}`);
  });

  if (deleteSource) {
    await esClient.indices.delete({ index: sourceIndex });
    console.log(`Deleted index ${sourceIndex}`);
  }
}

/**
 * Get the Elasticsearch reindexing status by listing the tasks that are of
 * type reindex
 *
 * @param {string} host - Elasticsearch host
 * @returns {Promise<Object>} - details of the tasks from Elasticsearch
 */
async function getStatus(host) {
  const esClient = await Search.es(host);

  return esClient.tasks.list({ actions: ['*reindex'] });
}

/**
 * Reindex the source index to the dest index
 *
 * @param {string} host - Elasticsearch host
 * @param {string} sourceIndex - index to reindex
 * @param {string} destIndex - destination index to reindex to
 * @param {string} aliasName - name of the alias Cumulus is using
 * @returns {Promise<Object>} - reindex response from ES which includes info on how many items
 * were updated with the reindex
 */
async function reindex(
  host,
  sourceIndex = null,
  destIndex = null,
  aliasName = defaultIndexAlias
) {
  /* eslint-disable no-param-reassign */
  const esClient = await Search.es(host);

  const aliasExists = await esClient.indices.existsAlias({
    name: aliasName
  });

  if (!aliasExists) {
    throw new Error(`Alias ${aliasName} does not exist. Before re-indexing, re-deploy your instance of Cumulus.`);
  }

  const alias = await esClient.indices.getAlias({
    name: aliasName
  });

  // alias keys = index name
  const indices = Object.keys(alias);

  if (sourceIndex === null) {
    if (indices.length > 1) {
      // We don't know which index to use as the source, throw error
      throw new Error(`Multiple indices found for alias ${aliasName}. Specify source index as one of [${indices.sort().join(', ')}].`);
    }

    sourceIndex = indices[0];
  } else {
    const sourceExists = await esClient.indices.exists({ index: sourceIndex });

    if (!sourceExists) {
      throw new Error(`Source index ${sourceIndex} does not exist.`);
    }

    if (indices.includes(sourceIndex) === false) {
      throw new Error(`Source index ${sourceIndex} is not aliased with alias ${aliasName}.`);
    }
  }

  if (destIndex === null) {
    const date = new Date();
    destIndex = `cumulus-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  const destExists = await esClient.indices.exists({ index: destIndex });

  if (destExists) {
    throw new Error(`Destination index ${destIndex} exists. Please specify an index name that does not exist.`);
  } else {
    // create destination index
    await esClient.indices.create({
      index: destIndex,
      body: { mappings }
    });

    console.log(`Created destination index ${destIndex}.`);
  }

  // reindex
  const reindexResponse = await esClient.reindex({
    body: {
      source: { index: sourceIndex },
      dest: { index: destIndex }
    }
  });

  return reindexResponse;
  /* eslint-enable no-param-reassign */
}

module.exports = {
  reindex,
  getStatus,
  completeReindex
};
