import omit from 'lodash/omit';
import isNil from 'lodash/isNil';
import Logger from '@cumulus/logger';
import { DbQueryParameters, QueryStringParameters, QueryTermField, QueryTermsField } from '../types/search';
import { mapQueryStringFieldToDbField } from './field-mapping';

const log = new Logger({ sender: '@cumulus/db/queries' });

const regexes: { [key: string]: RegExp } = {
  terms: /^(.*)__in$/,
  term: /^((?!__).)*$/,
  not: /^(.*)__not$/,
  exists: /^(.*)__exists$/,
  range: /^(.*)__(from|to)$/,
};

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
 * build term query fields for db query parameters from query string fields
 *
 * @param type -
 * @param queryFields -
 * @param regex -
 * @returns updated db query parameters
 */
const buildTerm = (
  type: string,
  queryFields: { name: string, value: string }[],
  regex: string
): { termFields: QueryTermField[] } => {
  const termFields: QueryTermField[] = [];

  queryFields.map((queryField: { name: string, value: string }) => {
    const match = queryField.name.match(regex);
    if (isNil(match)) return undefined;
    const fieldName = match[1];

    const queryParam = mapQueryStringFieldToDbField(type, { ...queryField, name: fieldName });
    return queryParam && termFields.push(queryParam);
  });
  return { termFields };
};

/**
 * build terms query fields for db query parameters from query string fields
 *
 * @param type -
 * @param queryFields -
 * @param regex -
 * @returns updated db query parameters
 */
const buildTerms = (
  type: string,
  queryFields: { name: string, value: string }[],
  regex: string
): { termsFields: QueryTermsField[] } => {
  const termsFields: QueryTermsField[] = [];

  queryFields.map((queryField: { name: string, value: string }) => {
    const match = queryField.name.match(regex);

    if (isNil(match)) return undefined;
    const fieldName = match[1];

    // field contains one or more terms, convert each of the term value
    const mappedFields: QueryTermField[] = queryField.value.split(',')
      .map((term: string) => mapQueryStringFieldToDbField(type, { name: fieldName, value: term }))
      .filter(Boolean) as QueryTermField[];

    if (mappedFields.length === 0) return undefined;

    const queryParam = {
      ...mappedFields[0],
      value: mappedFields.map((field) => field.value),
    };
    termsFields.push(queryParam);
    return queryParam;
  });
  return { termsFields };
};

const build: { [key: string]: Function } = {
  term: buildTerm,
  terms: buildTerms,
};

// NOT handled
// ISO string to date?
//error: granulePgRecord.error,
//execution: executionUrls[0] ? executionUrls[0].url : undefined,
//files: files.length > 0 ? files.map((file) => translatePostgresFileToApiFile(file)) : [],

// match and determine the category
// map api granule fields to postgres field and add to dbQueryParameters
// build db search
// TODO q parameter is the query to execute directly
// TODO nested error fieldsjjj

export const buildDbQueryParameters = (
  type: string,
  queryStringParameters: QueryStringParameters
): DbQueryParameters => {
  const { limit, page, prefix, infix, fields: returnFields, q } = queryStringParameters;

  const dbQueryParameters: DbQueryParameters = {};
  dbQueryParameters.page = Number.parseInt(page ?? '1', 10);
  dbQueryParameters.limit = Number.parseInt(limit ?? '10', 10);
  dbQueryParameters.offset = (dbQueryParameters.page - 1) * dbQueryParameters.limit;

  if (typeof infix === 'string') dbQueryParameters.infix = infix;
  if (typeof prefix === 'string') dbQueryParameters.prefix = prefix;
  if (typeof q === 'string') dbQueryParameters.q = q;
  if (typeof returnFields === 'string') dbQueryParameters.returnFields = returnFields.split(',');

  // remove reserved words (that are not fields)
  const fieldParams = omit(queryStringParameters, reservedWords);
  // determine which search strategy should be applied
  // options are term, terms, range, exists and not in
  const fields = Object.entries(fieldParams).map(([name, value]) => ({ name, value }));

  Object.keys(regexes).forEach((k: string) => {
    const matchedFields = fields.filter((f: any) => f.name.match(regexes[k]));

    if (matchedFields && matchedFields.length > 0 && build[k]) {
      const queryParams = build[k](type, matchedFields, regexes[k]);
      Object.assign(dbQueryParameters, queryParams);
    }
  });

  log.debug(`buildDbQueryParameters returns ${JSON.stringify(dbQueryParameters)}`);
  return dbQueryParameters;
};
