const { CMR } = require('@cumulus/cmr-client');
const log = require('@cumulus/common/log');
const {
  createRejectableTransaction,
  getGranuleCollectionId,
  GranulePgModel,
} = require('@cumulus/db');
const cmrjsCmrUtils = require('@cumulus/cmrjs/cmr-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

/**
 * @typedef {import('@cumulus/db').PostgresCollectionRecord} PostgresCollectionRecord
 * @typedef {import('@cumulus/db').PostgresGranuleRecord} PostgresGranuleRecord
 * @typedef {import('knex').Knex} Knex
 *
 * @typedef {(granule: unknown, collectionId: string) => Promise<void>} RemoveGranuleFromCmrFn
 */

/**
 * Remove granule record from CMR
 *
 * @param {Object} granule - A postgres granule record
 * @param {string} collectionId - The CMR collection 'id' for the granule to be removed
 * @throws {GranuleNotPublished|Error}
 * @private
 */
const _removeGranuleFromCmr = async (granule, collectionId) => {
  let metadata = false;
  log.info(`granules.removeGranuleFromCmrByGranule granule_id: ${granule.granule_id}, colletion_id: ${collectionId}`);
  if (!granule.published || !granule.cmr_link) {
    log.warn(`Granule ${granule.granule_id} in Collection ${collectionId} is not published to CMR, so cannot be removed from CMR`);
  }

  const cmrSettings = await cmrjsCmrUtils.getCmrSettings();
  const cmr = new CMR(cmrSettings);
  if (granule.cmr_link) {
    metadata = await cmr.getGranuleMetadata(granule.cmr_link);
  }

  // Use granule UR to delete from CMR
  if (metadata) {
    try {
      await cmr.deleteGranule(metadata.title, collectionId);
    } catch (error) {
      log.warn(`Granule ${granule.granule_id} in Collection ${collectionId} is not published to CMR, so cannot be removed from CMR`);
    }
  }
};

/**
 * Remove granule record from CMR and update Postgres + Dynamo granules
 *
 * @param {Object} params
 * @param {Knex} params.knex - DB client
 * @param {PostgresGranuleRecord} params.pgGranuleRecord - A Postgres granule record
 * @param {PostgresCollectionRecord} [params.pgCollection] - A Postgres Collection record
 * @param {GranulePgModel} [params.granulePgModel=new GranulePgModel()]
 *  - Instance of granules model for PostgreSQL
 * @param {RemoveGranuleFromCmrFn} [params.removeGranuleFromCmrFunction]
 *  - passed in function used for test mocking
 * @returns {Promise<{pgGranule: unknown}>}
 *  - Updated postgres granule
 */
const unpublishGranule = async ({
  knex,
  pgGranuleRecord,
  pgCollection,
  granulePgModel = new GranulePgModel(),
  removeGranuleFromCmrFunction = _removeGranuleFromCmr,
}) => {
  /** @type {string} */
  let collectionId;
  if (pgCollection) {
    collectionId = constructCollectionId(pgCollection.name, pgCollection.version);
  } else {
    collectionId = await getGranuleCollectionId(knex, pgGranuleRecord);
  }

  // If we cannot find a Postgres Collection or Postgres Granule,
  // don't update the Postgres Granule, continue to update the Dynamo granule
  const pgGranuleCumulusId = pgGranuleRecord.cumulus_id;
  return await createRejectableTransaction(knex, async (trx) => {
    const [pgGranule] = await granulePgModel.update(
      trx,
      {
        cumulus_id: pgGranuleCumulusId,
      },
      {
        published: false,
        // using `undefined` would result in Knex ignoring this binding
        // for the update. also, `undefined` is not a valid SQL value, it
        // should be `null` instead
        cmr_link: trx.raw('DEFAULT'),
      },
      ['*']
    );

    await removeGranuleFromCmrFunction(pgGranuleRecord, collectionId);
    return { pgGranule };
  });
};

module.exports = {
  unpublishGranule,
};
