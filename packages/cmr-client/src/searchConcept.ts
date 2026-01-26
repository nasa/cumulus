import got, { Headers } from 'got';
import Logger from '@cumulus/logger';

import { getSearchUrl } from './getUrl';
import { parseXMLString, redactAuthorization } from './Utils';

const log = new Logger({ sender: 'cmr-client/searchConcept' });

export interface Echo10Response {
  results: {
    result?: unknown[]
  }
}

export interface JsonResponse {
  body: {
    feed: {
      entry: unknown[]
    }
  }
}

export interface UmmJsonResponse {
  body: {
    items: unknown[]
  }
}

/**
 *
 * @param {Object} params
 * @param {string} params.type - Concept type to search, choices: ['collections', 'granules']
 * @param {string} params.cmrEnvironment - optional, CMR environment to
 *              use valid arguments are ['PROD', 'OPS', 'SIT', 'UAT']
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
// eslint-disable-next-line complexity
export async function searchConcept({
  type,
  searchParams,
  previousResults = [],
  headers = {},
  format = 'json',
  recursive = true,
  cmrEnvironment = process.env.CMR_ENVIRONMENT,
  cmrLimit,
  cmrPageSize,
}: {
  type: string,
  searchParams: URLSearchParams,
  previousResults?: unknown[],
  headers?: Headers,
  format?: string,
  recursive?: boolean,
  cmrEnvironment?: string,
  cmrLimit?: number,
  cmrPageSize?: number,
}): Promise<unknown[]> {
  let recordsLimit;
  if (typeof cmrLimit === 'number') {
    recordsLimit = cmrLimit;
  } else if (process.env.CMR_LIMIT) {
    recordsLimit = Number(process.env.CMR_LIMIT);
  } else {
    recordsLimit = 100;
  }

  const searchParamsPageSize = searchParams.get('pageSize');

  let pageSize: number;
  if (searchParamsPageSize) {
    pageSize = Number(searchParamsPageSize);
  } else if (typeof cmrPageSize === 'number') {
    pageSize = cmrPageSize;
  } else if (process.env.CMR_PAGE_SIZE) {
    pageSize = Number(process.env.CMR_PAGE_SIZE);
  } else {
    pageSize = 50;
  }

  const query = new URLSearchParams(searchParams);

  const queryPageNum = query.get('page_num');
  const pageNum = queryPageNum === null ? 1 : (Number(queryPageNum) + 1);

  query.delete('page_num');
  query.append('page_num', String(pageNum));

  if (!query.has('page_size')) query.append('page_size', String(pageSize));

  let response;
  try {
    response = await got.get(
      `${getSearchUrl({ cmrEnv: cmrEnvironment })}${type}.${format.toLowerCase()}`,
      {
        responseType: format.endsWith('json') ? 'json' : undefined,
        searchParams: query,
        headers,
      }
    );
  } catch (error) {
    log.error(`Error executing CMR search concept.
      Searching ${getSearchUrl({ cmrEnv: cmrEnvironment })}${type}.${format.toLowerCase()}
      with search parameters ${query}
      and headers ${JSON.stringify(redactAuthorization(headers))}`);
    log.error(JSON.stringify(error, Object.getOwnPropertyNames(error)));
    throw error;
  }

  const responseItems
    = format === 'echo10'
      ? (<Echo10Response>(await parseXMLString(<string>response.body))).results.result || []
      : (<UmmJsonResponse>response).body.items || (<JsonResponse>response).body.feed.entry;

  const fetchedResults = previousResults.concat(responseItems || []);

  const numRecordsCollected = fetchedResults.length;

  const cmrHits = response.headers['cmr-hits'];
  if (typeof cmrHits !== 'string') {
    throw new TypeError('cmr-hits header not found');
  }

  const CMRHasMoreResults = Number(cmrHits) > numRecordsCollected;
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
