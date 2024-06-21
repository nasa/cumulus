//@ts-check

//TODO update logging
const Logger = require('@cumulus/logger');

const { getEsClient, defaultIndexAlias } = require('./search');

const log = new Logger({ sender: '@cumulus/es-client/executions' });

/**
 * Generates a list of execution record IDs from an Elasticsearch Index
 *
 * @param {Object} esClient - The Elasticsearch client object.
 * @param {string} index - The name of the Elasticsearch index.
 * @param {string} collectionId - The ID of the collection to match.
 * @param {number} batchSize - The number of records to fetch in each batch.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of record IDs.
 * @throws {Error} Throws an error if fetching the record IDs fails.
 */
const _fetchEsRecordIds = async (esClient, index, collectionId, batchSize) => {
  try {
    const response = await esClient.client.search({
      index,
      type: 'execution',
      scroll: process.env.ES_SCROLL_TIME || '5m',
      body: {
        query: {
          match: {
            collectionId,
          },
        },
        _source: false,
      },
      size: batchSize,
    });
    return response.body.hits.hits.map((hit) => hit._id);
  } catch (error) {
    // TODO: Use Core Logger Method
    log.error(`Failed to get recordIds ${JSON.stringify(error)}`);
    throw new Error(`Failed to fetch record IDs from Elasticsearch index ${index}: ${error.message}`);
  }
};

/**
 * Deletes executions in batches by collection ID.
 *
 * @param {Object} params - The parameters for the function.
 * @param {string} [params.index] - The index to delete from.
 * @param {string} params.collectionId - The ID of the collection.
 * @param {number} params.batchSize - The size of the batches to delete.
 * @returns {Promise<void>} A promise that resolves when the deletions are complete.
 */
const batchDeleteExecutionsByCollection = async ({
  index = defaultIndexAlias,
  collectionId,
  batchSize,
}) => {
  // TODO - Should we return the number of records deleted
  try {
    const esClient = await getEsClient();
    // TODO make this error better
    if (!esClient.client) {
      throw new Error('ES client not initialized!');
    }
    let recordIds;
    let failures = 0;
    while (recordIds === undefined || recordIds.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      recordIds = await _fetchEsRecordIds(
        esClient,
        index,
        collectionId,
        batchSize
      );
      if (recordIds.length > 0) {
        const body = recordIds.map((id) => ({
          delete: { _index: index, _type: 'execution', _id: id },
        }));
        // eslint-disable-next-line no-await-in-loop
        const response = await esClient.client.bulk({ body, refresh: 'true' });
        if (response.body.errors) {
          failures += 1;
          log.error(`Bulk deletion encountered errors: ${JSON.stringify(
            response.body.errors
          )}`);
        }
      }
      log.info(
        `Successfully deleted ${recordIds.length} execution records from ${index} for collection ${collectionId}`
      );
      if (failures > 0) {
        log.info(`${failures} errors encountered during deletion - please check logs for details`);
      }
    }
  } catch (error) {
    log.error(`Failed to delete execution records from ${index}: ${error.message}`);
    throw error;
  }
};

module.exports = {
  batchDeleteExecutionsByCollection,
};
