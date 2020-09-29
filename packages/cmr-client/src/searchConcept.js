'use strict';

const got = require('got');
const getUrl = require('./getUrl');
const { parseXMLString } = require('./Utils');

/**
 *
 * @param {Object} params
 * @param {string} params.type - Concept type to search, choices: ['collections', 'granules']
 * @param {string} params.cmrEnvironment - optional, CMR environment to
 *              use valid arguments are ['OPS', 'SIT', 'UAT']
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
  cmrEnvironment = process.env.CMR_ENVIRONMENT,
  cmrLimit = process.env.CMR_LIMIT,
  cmrPageSize = process.env.CMR_PAGE_SIZE,
}) {
  const recordsLimit = cmrLimit || 100;
  const pageSize = searchParams.pageSize || cmrPageSize || 50;

  const query =
    searchParams instanceof URLSearchParams
      ? searchParams
      : new URLSearchParams(searchParams);

  const pageNum = query.has('page_num') ? +query.get('page_num') + 1 : 1;
  query.delete('page_num');
  query.append('page_num', pageNum);

  if (!query.has('page_size')) query.append('page_size', pageSize);

  const url = `${getUrl('search', undefined, cmrEnvironment)}${type}.${format.toLowerCase()}`;
  const response = await got.get(
    url,
    {
      responseType: format.endsWith('json') ? 'json' : undefined,
      searchParams: query,
      headers,
    }
  );

  const responseItems =
    format === 'echo10'
      ? (await parseXMLString(response.body)).results.result || []
      : response.body.items || response.body.feed.entry;

  const fetchedResults = previousResults.concat(responseItems || []);

  const numRecordsCollected = fetchedResults.length;
  const CMRHasMoreResults = response.headers['cmr-hits'] > numRecordsCollected;
  const recordsLimitReached = numRecordsCollected >= recordsLimit;
  if (recursive && CMRHasMoreResults && !recordsLimitReached) {
    return searchConcept({
      type,
      searchParams: query,
      previousResults: fetchedResults,
      headers,
      format,
      recursive,
    });
  }
  return fetchedResults.slice(0, recordsLimit);
}

module.exports = searchConcept;
