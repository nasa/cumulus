'use strict';

const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');

const { getCollectionsByShortNameAndVersion } = require('@cumulus/cmrjs');

const Logger = require('@cumulus/logger');
const log = new Logger({ sender: 'api/lib/mmt' });

/**
 * Returns the environment specific identifier for the input cmr environment.
 * @param {string} env - cmr environment ['PROD', 'OPS', 'SIT', 'UAT']
 * @returns {string} - value to use to build correct cmr url for environment.
 */
function hostId(env) {
  switch (env) {
  case 'PROD':
  case 'OPS':
    return '';
  case 'UAT':
    return 'uat';
  case 'SIT':
  default:
    return 'sit';
  }
}

/**
 * Returns the MMT URL string for collection based on conceptId and Cumulus
 * environment.
 *
 * @param {string} conceptId - CMR's concept id
 * @param {string} cmrEnv - Cumulus instance operating environ UAT/SIT/PROD
 * @returns {string} MMT URL string to edit the collection at conceptId
 */
const buildMMTLink = (conceptId, cmrEnv = process.env.CMR_ENVIRONMENT) => {
  const url = ['mmt', hostId(cmrEnv), 'earthdata.nasa.gov']
    .filter((value) => value)
    .join('.');
  return `https://${url}/collections/${conceptId}`;
};

/**
 * Updates the Collection query results with a MMTLink when the
 * matching CMR entry contains a collection_id.
 *
 * @param {Array<Object>} queryResults - collection query results from Cumulus DB
 * @param {Array<Object>} cmrEntries - cmr response feed entry that should match the
 *                                     results collections
 * @returns {Array<Object>} - Array of shallow clones of queryResults objects with
 *                            MMTLinks added to them
 */
const updateResponseWithMMT = (queryResults, cmrEntries) => queryResults.map((res) => {
  const matchedCmr = cmrEntries.filter(
    (entry) => entry.short_name === res.name && entry.version_id === res.version
  );
  const collectionId = get(matchedCmr[0], 'id');
  const MMTLink = collectionId ? buildMMTLink(collectionId) : undefined;
  return { ...res, MMTLink };
});

/**
 * Simplifies and transforms the results from a collection query
 * into a list of objects suitable for a compound call to CMR to retrieve
 * collection_id information.
 *  Transforms each object in the results array into an new object.
 *  inputObject.name => outputObject.short_name
 *  inputObject.version => outputObject.version
 *  all other input object keys are dropped.
 *
 * @param {Object} results - The results array returned from either
 *          Collection.query() or Collection.queryCollectionsWithActiveGranules()
 * @returns {Arary<Object>} - list of Objects with two keys (short_name and version).
 */
const parseResults = (results) =>
  results.map((object) => ({
    short_name: object.name,
    version: object.version,
  }));

/**
 * parses the query collection lists and for each result inserts a "MMTLink"
 * into the collection object.
 *
 * @param {Object} inputResponse - a reponse returned from either
 *          Collection.query() or Collection.queryCollectionsWithActiveGranules()
 * @returns {Object} a copy of input response object where each collection
 *      has been updated to include a link to the Metadata Management Tool
 */
const insertMMTLinks = async (inputResponse) => {
  const response = cloneDeep(inputResponse);
  try {
    const responseList = parseResults(inputResponse.results);
    const cmrResults = await getCollectionsByShortNameAndVersion(responseList);
    response.results = updateResponseWithMMT(inputResponse.results, cmrResults.feed.entry);
  } catch (error) {
    log.error('Unable to update inputResponse with MMT Links');
    log.error(error);
    return inputResponse;
  }
  return response;
};

module.exports = insertMMTLinks;
