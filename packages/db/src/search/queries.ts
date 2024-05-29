import omit from 'lodash/omit';
import Logger from '@cumulus/logger';
import { DbQueryParameters, QueryStringParameters, RangeType, SortType } from '../types/search';
import { mapQueryStringFieldToDbField } from './field-mapping';

const log = new Logger({ sender: '@cumulus/db/queries' });

// reserved words which are not record fields
const reservedWords = [
  'limit',
  'page',
  'skip',
  'sort_by',
  'sort_key',
  'order',
  'prefix',
  'infix',
  'fields',
  'searchContext',
];

/**
 * regexp for matching api query string parameter to query type
 */
const regexes: { [key: string]: RegExp } = {
  terms: /^(.*)__in$/,
  term: /^((?!__).)*$/,
  not: /^(.*)__not$/,
  exists: /^(.*)__exists$/,
  range: /^(.*)__(from|to)$/,
};

/**
 * Convert range query fields to db query parameters from api query string fields
 *
 * @param type - query record type
 * @param queryStringFields - api query fields
 * @returns range query parameter
 */
const convertRange = (
  type: string,
  queryStringFields: { name: string, value: string }[]
): { range: { [key: string]: RangeType } } => {
  const range = queryStringFields.reduce((acc: { [key: string]: RangeType }, queryField) => {
    const match = queryField.name.match(regexes.range);
    if (!match) return acc;

    // get corresponding db field name, e.g. timestamp => updated_at
    const dbField = mapQueryStringFieldToDbField(type, { ...queryField, name: match[1] });
    if (!dbField) return acc;
    const dbFieldName = Object.keys(dbField)[0];

    // build a range field, e.g.
    // { timestamp__from: '1712708508310', timestamp__to: '1712712108310' } =>
    // { updated_at: {
    //     gte: new Date(1712708508310),
    //     lte: new Date(1712712108310),
    //   },
    // }
    const rangeField: { [key: string]: RangeType } = { [dbFieldName]: acc[dbFieldName] || {} };
    if (match[2] === 'from') {
      rangeField[dbFieldName].gte = dbField[dbFieldName];
    }
    if (match[2] === 'to') {
      rangeField[dbFieldName].lte = dbField[dbFieldName];
    }
    return { ...acc, ...rangeField };
  }, {});

  return { range };
};

/**
 * Convert term query fields to db query parameters from api query string fields
 *
 * @param type - query record type
 * @param queryStringFields - api query fields
 * @returns term query parameter
 */
const convertTerm = (
  type: string,
  queryStringFields: { name: string, value: string }[]
): { term: { [key: string]: any } } => {
  const term = queryStringFields.reduce((acc, queryField) => {
    const queryParam = mapQueryStringFieldToDbField(type, queryField);
    return { ...acc, ...queryParam };
  }, {});

  return { term };
};

/**
 * Convert sort query fields to db query parameters from api query string fields
 *
 * @param type - query record type
 * @param queryStringFields - api query fields
 * @returns sort query parameter
 */
const convertSort = (
  type: string,
  queryStringParameters: QueryStringParameters
): SortType[] => {
  const sortArray: SortType[] = [];
  const { sort_by: sortBy, sort_key: sortKey } = queryStringParameters;
  let { order } = queryStringParameters;
  if (sortBy) {
    order = order ?? 'asc';
    const queryParam = mapQueryStringFieldToDbField(type, { name: sortBy });
    Object.keys(queryParam as Object).map((key) => sortArray.push({ column: key, order }));
  } else if (sortKey) {
    sortKey.map((item) => {
      order = item.startsWith('-') ? 'desc' : 'asc';
      const queryParam = mapQueryStringFieldToDbField(type, { name: item.replace(/^[+-]/, '') });
      return Object.keys(queryParam as Object).map((key) => sortArray.push({ column: key, order }));
    });
  }
  return sortArray;
};

/**
 * functions for converting from api query string parameters to db query parameters
 * for each type of query
 */
const convert: { [key: string]: Function } = {
  range: convertRange,
  term: convertTerm,
};

/**
 * Convert api query string parameters to db query parameters
 *
 * @param type - query record type
 * @param queryStringParameters - query string parameters
 * @returns db query parameters
 */
export const convertQueryStringToDbQueryParameters = (
  type: string,
  queryStringParameters: QueryStringParameters
): DbQueryParameters => {
  const { limit, page, prefix, infix, fields } = queryStringParameters;

  const dbQueryParameters: DbQueryParameters = {};
  dbQueryParameters.page = Number.parseInt(page ?? '1', 10);
  dbQueryParameters.limit = Number.parseInt(limit ?? '10', 10);
  dbQueryParameters.offset = (dbQueryParameters.page - 1) * dbQueryParameters.limit;

  if (typeof infix === 'string') dbQueryParameters.infix = infix;
  if (typeof prefix === 'string') dbQueryParameters.prefix = prefix;
  if (typeof fields === 'string') dbQueryParameters.fields = fields.split(',');
  dbQueryParameters.sort = convertSort(type, queryStringParameters);

  // remove reserved words (that are not fields)
  const fieldParams = omit(queryStringParameters, reservedWords);
  // determine which search strategy should be applied
  // options are term, terms, range, exists and not in
  const fieldsList = Object.entries(fieldParams).map(([name, value]) => ({ name, value }));

  // for each search strategy, get all parameters and convert them to db parameters
  Object.keys(regexes).forEach((k: string) => {
    const matchedFields = fieldsList.filter((f) => f.name.match(regexes[k]));

    if (matchedFields && matchedFields.length > 0 && convert[k]) {
      const queryParams = convert[k](type, matchedFields, regexes[k]);
      Object.assign(dbQueryParameters, queryParams);
    }
  });

  log.debug(`convertQueryStringToDbQueryParameters returns ${JSON.stringify(dbQueryParameters)}`);
  return dbQueryParameters;
};
