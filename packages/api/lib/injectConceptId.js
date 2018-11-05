'use strict';

const cloneDeep = require('lodash.clonedeep');

const cmrjs = require('@cumulus/cmrjs');

/**
 * Given a collection record with a name and version, search CMR for a single
 * matching collection and return the concept-id if it exists.
 * @param {Object} collectionRecord - cumulus collection record.
 * @returns {string} CMR's concept-id for the record, or null.
 */
const updateRecordWithConceptId = async (collectionRecord) => {
  let updatedCollectionRecord = cloneDeep(collectionRecord);
  const searchParams = {
    short_name: collectionRecord.name || '',
    version: collectionRecord.version || '',
    provider_short_name: process.env.cmr_provider
  };

  const cmrResult = await cmrjs.searchConcept('collections', searchParams, []);

  let conceptId = null;
  if (cmrResult.length === 1) conceptId = cmrResult[0].id;
  updatedCollectionRecord = Object.assign(collectionRecord, { conceptId: conceptId });
  return updatedCollectionRecord;
};

/**
 * Add concept-id to collection record
 * @param {Array} collections - array of collection results
 * @returns {Array} - input array with each element updated with its found concept-id or null.
 */
const injectConceptIds = async (collections) => {
  const injectedResults = await Promise.all(
    collections.results.map(module.exports.updateRecordWithConceptId)
  );
  collections.results = injectedResults; // eslint-disable-line no-param-reassign
  return collections;
};

module.exports = {
  updateRecordWithConceptId,
  injectConceptIds
};
