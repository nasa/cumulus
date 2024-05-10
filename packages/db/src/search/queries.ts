import omit from 'lodash/omit';
import Logger from '@cumulus/logger';
import { DbQueryParameters, QueryStringParameters } from '../types/search';
import { mapQueryStringFieldToDbField } from './field-mapping';

const log = new Logger({ sender: '@cumulus/db/queries' });

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
 * regexp for matching query string parameter to query type
 */
const regexes: { [key: string]: RegExp } = {
  terms: /^(.*)__in$/,
  term: /^((?!__).)*$/,
  not: /^(.*)__not$/,
  exists: /^(.*)__exists$/,
  range: /^(.*)__(from|to)$/,
};

/**
 * build term query fields for db query parameters from query string fields
 *
 * @param type - query record type
 * @param queryFields - query fields
 * @returns term
 */
const buildTerm = (
  type: string,
  queryFields: { name: string, value: string }[]
): { term: { [key: string]: any } } => {
  const term = queryFields.reduce((acc, queryField) => {
    const queryParam = mapQueryStringFieldToDbField(type, queryField);
    return {
      ...acc,
      ...queryParam,
    };
  }, {});

  return { term };
};

/**
 * functions for building db query parameters for each query type
 */
const build: { [key: string]: Function } = {
  term: buildTerm,
};

/**
 * build db query parameters from query string parameters
 *
 * @param type - query record type
 * @param queryStringParameters - query string parameters
 * @returns db query parameters
 */
export const buildDbQueryParameters = (
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

  // remove reserved words (that are not fields)
  const fieldParams = omit(queryStringParameters, reservedWords);
  // determine which search strategy should be applied
  // options are term, terms, range, exists and not in
  const fieldsList = Object.entries(fieldParams).map(([name, value]) => ({ name, value }));

  // for each search strategy, get all parameters and convert them to db parameters
  Object.keys(regexes).forEach((k: string) => {
    const matchedFields = fieldsList.filter((f: any) => f.name.match(regexes[k]));

    if (matchedFields && matchedFields.length > 0 && build[k]) {
      const queryParams = build[k](type, matchedFields, regexes[k]);
      Object.assign(dbQueryParameters, queryParams);
    }
  });

  log.debug(`buildDbQueryParameters returns ${JSON.stringify(dbQueryParameters)}`);
  return dbQueryParameters;
};
