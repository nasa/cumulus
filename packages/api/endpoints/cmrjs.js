'use strict'

const router = require('express-promise-router')();
const { CMR, hostId } = require('@cumulus/cmrjs');

/**
 * Search for a collection given a Provider, Collection Name and version
 * 
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function getCollection(req, res) {
  const cmrProvider = req.params.provider;
  const collectionName = req.params.name;
  const collectionVersion = req.params.version;
  const cmrEnvironment = req.params.env;

  const search = new CMR(cmrProvider);
  return search.searchCollections({short_name: collectionName, version: collectionVersion})
    .then((results) => {
      if (results.length === 1) {
        const conceptId = results[0].id;
        if (conceptId) {
          return buildMMTLink(conceptId, cmrEnvironment);
        }
      }
      return null;
    })
    .catch((error) => {
      console.log(error);
    });
}

/**
 * Build correct link to collection based on conceptId and cumulus environment.
 *
 * @param {string} conceptId - CMR's concept id
 * @param {string} cmrEnv - cumulus instance operating environ UAT/SIT/PROD.
 * @returns {string} MMT link to edit the collection at conceptId.
 */
export const buildMMTLink = (conceptId, cmrEnv) => { // Get hostID based on env
  const url = ['mmt', hostId(cmrEnv), 'earthdata.nasa.gov'].filter((d) => d).join('.');
  return `https://${url}/collections/${conceptId}`;
};

router.get('/cmrjs/collection/:provider/:name/:version/:env', getCollection);
module.exports = router;
