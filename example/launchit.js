const { bulkChangeCollection, bulkPatch } = require('@cumulus/api-client/granules');
const { createCollection } = require('@cumulus/api-client/collections');
const { getKnexClient, CollectionPgModel, translatePostgresGranuleToApiGranule, ProviderPgModel } = require('../packages/db/dist');
process.env.DISABLE_PG_SSL = 'true';
const getGranuleBatch = async (
  knex,
  collectionCumulusId,
  startAt,
  batchSize,
) => {
  return await knex('granules')
    .where({collection_cumulus_id: collectionCumulusId})
    .andWhere('cumulus_id', '>', startAt)
    .orderBy('cumulus_id')
    .limit(batchSize);
}
const main = async () => {
  await bulkChangeCollection({
    prefix: 'ecarton-ci-tf',
    body: {
      sourceCollectionId: 'MOD11A1___000',
      targetCollectionId: 'MOD11A1___001',
      concurrency: 100,
      batchSize: 3000
    }
  });

};
  
if (require.main === module) {
main(
).then(
    (ret) => ret
).catch((error) => {
    console.log(`failed: ${error}`);
    throw error;
});
}
