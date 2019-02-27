'use strict';

const got = require('got');
const { getUrl } = require('./getUrl');

/**
 *
 * @param {string} type - Concept type to search, choices: ['collections', 'granules']
 * @param {Object} searchParams - CMR search parameters
 * Note initial searchParams.page_num should only be set if recursive is false
 * @param {Array} previousResults - array of results returned in previous recursive calls
 * to be included in the results returned
 * @param {Object} headers - the CMR headers
 * @param {string} format - format of the response
 * @param {boolean} recursive - indicate whether search recursively to get all the result
 * @returns {Promise.<Array>} - array of search results.
 */
async function searchConcept(type, searchParams, previousResults = [], headers = {}, format = 'json', recursive = true) {
  const recordsLimit = process.env.CMR_LIMIT || 100;
  const pageSize = searchParams.pageSize || process.env.CMR_PAGE_SIZE || 50;

  const defaultParams = { page_size: pageSize };

  const url = `${getUrl('search')}${type}.${format.toLowerCase()}`;

  const pageNum = (searchParams.page_num) ? searchParams.page_num + 1 : 1;

  // if requested, recursively retrieve all the search results for collections or granules
  const query = Object.assign({}, defaultParams, searchParams, { page_num: pageNum });
  const response = await got.get(url, { json: true, query, headers });
  const responseItems = (format === 'umm_json') ? response.body.items : response.body.feed.entry;
  const fetchedResults = previousResults.concat(responseItems || []);

  const numRecordsCollected = fetchedResults.length;
  const CMRHasMoreResults = response.headers['cmr-hits'] > numRecordsCollected;
  const recordsLimitReached = numRecordsCollected >= recordsLimit;
  if (recursive && CMRHasMoreResults && !recordsLimitReached) {
    return searchConcept(type, query, fetchedResults, headers, format, recursive);
  }
  return fetchedResults.slice(0, recordsLimit);
}

module.exports = searchConcept;
