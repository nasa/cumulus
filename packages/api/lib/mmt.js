'use strict';

const { CMR } = require('@cumulus/cmr-client');
const hostId = require('@cumulus/cmr-client/hostId');
const { getCmrSettings } = require('@cumulus/cmrjs/cmr-utils');

const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');

let cmr;

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
 * Looks up the CMR collectionId of the input object, returns a shallow copy of
 * the object with the collectionId added as a key.
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
