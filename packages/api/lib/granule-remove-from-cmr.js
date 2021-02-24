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
 * Remove granule record from CMR and update PG + Dynamo granules
 *
 * @param {Knex | Knex.transaction} knexOrTransaction - DB client
 * @param {Object} granule - A granule record
 * @returns {Promise} - output of Granule Dynamo model's update()
 */
const unpublishGranule = async (knexOrTransaction, granule) => {
  const granuleModelClient = new models.Granule();
  const granulePgModel = new GranulePgModel();
  const collectionPgModel = new CollectionPgModel();

  let pgGranule;

  await _removeGranuleFromCmr(granule);

  // If we cannot find a PG Collection or PG Granule,
  // don't update the PG Granule, continue to update the Dynamo granule
  try {
    const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
      knexOrTransaction,
      deconstructCollectionId(granule.collectionId)
    );

    [pgGranule] = await granulePgModel.update(
      knexOrTransaction,
      {
        granule_id: granule.granuleId,
        collection_cumulus_id: collectionCumulusId,
      },
      {
        published: false,
        cmr_link: undefined,
      },
      ['cumulus_id']
    );
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  return {
    dynamoGranule: await granuleModelClient.update({ granuleId: granule.granuleId }, { published: false }, ['cmrLink']),
    pgGranule: pgGranule,
  };
};

module.exports = {
  unpublishGranule,
};
