const { GranuleNotPublished } = require('@cumulus/errors');
const { CMR } = require('@cumulus/cmr-client');
const log = require('@cumulus/common/log');
const { GranulePgModel } = require('@cumulus/db');
const cmrjsCmrUtils = require('@cumulus/cmrjs/cmr-utils');

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

  await _removeGranuleFromCmr(granule);

  await granulePgModel.update(
    knexOrTransaction,
    { granule_id: granule.granuleId },
    {
      published: false,
      cmr_link: undefined,
    }
  );

  return granuleModelClient.update({ granuleId: granule.granuleId }, { published: false }, ['cmrLink']);
};

module.exports = {
  unpublishGranule,
};
