'use strict';

const cmrjs = require('@cumulus/cmrjs');

/**
 * Given a collection record with a name and version, search CMR for a single
 * matching collection and return the concept-id if it exists.
 * @param {Object} collectionRecord - cumulus collection record.
 * @returns {string} CMR's concept-id for the record, or null.
 */
const getConceptId = async (collectionRecord) => {
  const searchParams = {
    short_name: collectionRecord.name || '',
    version: collectionRecord.version || '',
    provider_short_name: process.env.cmr_provider
  };

  const cmrResult = await cmrjs.searchConcept('collections', searchParams, []);

  if (cmrResult.length !== 1) return null;
  return cmrResult[0].id;
};

/**
 * Add concept-id to collection record
 * @param {Array} collections - array of collection results
 * @param {function} conceptIdFunction - function to use to return a
 *                   conceptId. Defaults to getConceptId.
 * @returns {Array} - input array with each element updated with its found concept-id or null.
 */
const injectConceptId = async (collections, conceptIdFunction = getConceptId) => {
  const conceptIds = collections.results.map(conceptIdFunction);
  const ids = await Promise.all(conceptIds);
  const updatedResults = collections.results.map(
    (results, index) => Object.assign(results, { conceptId: ids[index] })
  );
  collections.results = updatedResults; // eslint-disable-line no-param-reassign
  return collections;
};

module.exports = {
  getConceptId,
  injectConceptId
};
