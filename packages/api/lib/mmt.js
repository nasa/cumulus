'use strict';

const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');

const { getCollectionsByShortNameAndVersion } = require('@cumulus/cmrjs');

const Logger = require('@cumulus/logger');
const log = new Logger({ sender: 'api/lib/mmt' });

/**
 * Returns the environment specific identifier for the input cmr environment.
 * @param {string} env - cmr environment ['OPS', 'SIT', 'UAT']
 * @returns {string} - value to use to build correct cmr url for environment.
 */
function hostId(env) {
  switch (env) {
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
 * Takes the Collection elasticsearch results and updates every results object
 * with an MMTLink if the result has a collectionId in the cmrEntries.
 * @param {Array<Object>} esResults - collection query results from Cumulus' elasticsearch
 * @param {Array<Object>} cmrEntries - cmr response feed entry that should match the
 *                                     results collections
 * @returns {Array<Object>} - Array of shallow clones of esResults objects with
 *                            MMTLinks added to them
 */
const updateResultsWithMMT = (esResults, cmrEntries) => esResults.map((res) => {
  const matchedCmr = cmrEntries.filter(
    (entry) => entry.short_name === res.name && entry.version_id === res.version
  );
  const collectionId = get(matchedCmr[0], 'id');
  const MMTLink = collectionId ? buildMMTLink(collectionId) : undefined;
  return { ...res, MMTLink };
});

/**
 * Creates a formatted list of shortname/version objects for use in a call to
 * CMR to retrive collection information.  transforms each object in the
 * results array into an new objects.
 *  inputObject.name => outputObject.short_name
 *  inputObject.version => outputObject.version
 * all other input object keys are ignored.
 *
 * @param {Object} results - an elasticsearch results array returned from either
 *          Collection.query() or Collection.queryCollectionsWithActiveGranules()
 * @returns {Arary<Object>} - list of Objects with two keys.
 */
const parseResults = (results) =>
  results.map((object) => ({
    short_name: object.name,
    version: object.version,
  }));

/**
 * parses the elasticsearch collection lists and for each result inserts a "MMTLink"
 * into the collection object.
 *
 * @param {Object} inputResponse - an elasticsearch reponse returned from either
 *          Collection.query() or Collection.queryCollectionsWithActiveGranules()
 * @returns {Object} a copy of input response object where each collection
 *      has been updated to include a link to the Metadata Management Tool
 */
const insertMMTLinks = async (inputResponse) => {
  const response = cloneDeep(inputResponse);
  try {
    const responseList = parseResults(inputResponse.results);
    const cmrResults = await getCollectionsByShortNameAndVersion(responseList);
    response.results = updateResultsWithMMT(inputResponse.results, cmrResults.feed.entry);
  } catch (error) {
    log.error('Unable to update inputResponse with MMT Links');
    log.error(error);
    return inputResponse;
  }
  return response;
};

module.exports = insertMMTLinks;
