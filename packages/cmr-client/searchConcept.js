'use strict';

const get = require('lodash.get');
const got = require('got');
const getUrl = require('./getUrl');
const { parseXMLString } = require('./Utils');

function createSearchQuery({
  searchParams,
  cmrPageSize = (process.env.CMR_PAGE_SIZE || 50)
}) {
  const pageSize = get(searchParams, 'pageSize', cmrPageSize);
  const pageNum = get(searchParams, 'page_num', 0) + 1;
  const defaultParams = { page_size: pageSize };
  // if requested, recursively retrieve all the search results for collections or granules
  return Object.assign({}, defaultParams, searchParams, { page_num: pageNum });
}

/**
 *
 * @param {Object} params
 * @param {string} params.type - Concept type to search, choices: ['collections', 'granules']
 * @param {Object} params.searchParams - CMR search parameters
 * Note initial searchParams.page_num should only be set if recursive is false
 * @param {Array} [params.previousResults=[]] - array of results returned in previous recursive
 * calls to be included in the results returned
 * @param {Object} [params.headers={}] - the CMR headers
 * @param {string} [params.format] - format of the response, supports umm_json, json, echo10
 * @param {boolean} [params.recursive] - indicate whether search recursively to get all the result
 * @param {number} params.cmrLimit - the CMR limit
 * @param {number} params.cmrPageSize - the CMR page size
 * @returns {Promise.<Array>} - array of search results.
 */
async function searchConcept({
  type,
  searchParams,
  previousResults = [],
  headers = {},
  format = 'json',
  recursive = true,
  cmrLimit = (process.env.CMR_LIMIT || 100),
  cmrPageSize
}) {
  const url = `${getUrl('search')}${type}.${format.toLowerCase()}`;
  const query = createSearchQuery({
    searchParams,
    cmrPageSize
  });
  const response = await got.get(url, { json: format.endsWith('json'), query, headers });

  const responseItems = (format === 'echo10')
    ? (await parseXMLString(response.body)).results.result || []
    : (response.body.items || response.body.feed.entry);

  const fetchedResults = previousResults.concat(responseItems || []);

  const numRecordsCollected = fetchedResults.length;
  const CMRHasMoreResults = response.headers['cmr-hits'] > numRecordsCollected;
  const recordsLimitReached = numRecordsCollected >= cmrLimit;
  if (recursive && CMRHasMoreResults && !recordsLimitReached) {
    return searchConcept({
      type,
      searchParams: query,
      previousResults: fetchedResults,
      headers,
      format,
      recursive
    });
  }
  return fetchedResults.slice(0, cmrLimit);
}

module.exports = searchConcept;
