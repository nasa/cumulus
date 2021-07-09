const { GranuleNotPublished, RecordDoesNotExist } = require('@cumulus/errors');
const { CMR } = require('@cumulus/cmr-client');
const log = require('@cumulus/common/log');
const { CollectionPgModel, GranulePgModel } = require('@cumulus/db');
const cmrjsCmrUtils = require('@cumulus/cmrjs/cmr-utils');
const { deconstructCollectionId } = require('./utils');

const models = require('../models');

/**
 * Remove granule record from CMR
 *
 * @param {Object} granule - A granule record
 * @throws {GranuleNotPublished|Error}
 * @private
 */
const _removeGranuleFromCmr = async (granule) => {
  log.info(`granules.removeGranuleFromCmrByGranule ${granule.granuleId}`);

  if (!granule.published || !granule.cmrLink) {
    throw new GranuleNotPublished(`Granule ${granule.granuleId} is not published to CMR, so cannot be removed from CMR`);
  }

  const cmrSettings = await cmrjsCmrUtils.getCmrSettings();
  const cmr = new CMR(cmrSettings);
  const metadata = await cmr.getGranuleMetadata(granule.cmrLink);

  // Use granule UR to delete from CMR
  await cmr.deleteGranule(metadata.title, granule.collectionId);
};

/**
 * Remove granule record from CMR and update Postgres + Dynamo granules
 *
 * @param {Knex} knex - DB client
 * @param {Object} granule - A granule record
 * @param {Object} granulePgModel - Instance of granules model for PostgreSQL
 * @param {Object} granuleDynamoModel - Instance of granules model for DynamoDB
 * @returns {Object} - Updated granules
 * @returns {Object.dynamoGranule} - Updated Dynamo Granule
 * @returns {Object.pgGranule} - Updated Postgres Granule
 */
const unpublishGranule = async (
  knex,
  granule,
  granulePgModel = new GranulePgModel(),
  granuleDynamoModel = new models.Granule()
) => {
  const collectionPgModel = new CollectionPgModel();
  let pgGranuleCumulusId;

  // If we cannot find a Postgres Collection or Postgres Granule,
  // don't update the Postgres Granule, continue to update the Dynamo granule
  try {
    const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
      knex,
      deconstructCollectionId(granule.collectionId)
    );

    pgGranuleCumulusId = await granulePgModel.getRecordCumulusId(
      knex,
      {
        granule_id: granule.granuleId,
        collection_cumulus_id: collectionCumulusId,
      }
    );
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  try {
    return await knex.transaction(async (trx) => {
      let pgGranule;
      if (pgGranuleCumulusId) {
        [pgGranule] = await granulePgModel.update(
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
      }
      const dynamoGranule = await granuleDynamoModel.update(
        { granuleId: granule.granuleId },
        { published: false },
        ['cmrLink']
      );
      await _removeGranuleFromCmr(granule);
      return { dynamoGranule, pgGranule };
    });
  } catch (error) {
    const updateParams = {
      published: granule.published,
    };
    if (granule.cmrLink) {
      updateParams.cmrLink = granule.cmrLink;
    }
    await granuleDynamoModel.update(
      { granuleId: granule.granuleId },
      updateParams
    );
    throw error;
  }
};

module.exports = {
  unpublishGranule,
};
