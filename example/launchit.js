const { bulkChangeCollection } = require('@cumulus/api-client/granules');
const { createCollection } = require('@cumulus/api-client/collections');

const main = async () => {
  bulkChangeCollection({
    prefix: 'ecarton_ci_tf',
    body: {
      sourceCollectionId: 'MOD11A1___000',
      targetCollectionId: 'MOD11A1___001',
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
  