'use strict';

const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');

const { CMR } = require('@cumulus/cmr-client');
const { getCmrSettings } = require('@cumulus/cmrjs/cmr-utils');

let cmr;

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
 * Looks up the CMR collectionId of the input object, and returns a shallow copy of
 * the input object updated to include a link to the collection MMT on the 'MMTlink' key.
 *
 * @param {Object} responseObj - input collection response object
 * @param {string} responseObj.name - collection short name
 * @param {string} responseObj.version - collection version
 * @returns {Promise<Object>} Promise of an updated object
 */
const updateObjectWithMMT = async (responseObj) => {
  const result = await cmr.searchCollections({
    short_name: responseObj.name,
    version: responseObj.version,
  });
  const collectionId = get(result[0], 'id');
  const MMTLink = collectionId ? buildMMTLink(collectionId) : undefined;
  return { ...responseObj, MMTLink };
};

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
  cmr = new CMR(await getCmrSettings());

  response.results = await Promise.all(
    inputResponse.results.map(updateObjectWithMMT)
  );

  return response;
};

module.exports = insertMMTLinks;
