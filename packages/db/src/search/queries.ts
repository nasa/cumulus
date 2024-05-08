import omit from 'lodash/omit';
import isNil from 'lodash/isNil';
import { DbQueryParameters, QueryStringParameters, QueryTermField } from '../types/search';
import { mapQueryStringFieldToDbField } from './field-mapping';

const regexes: any = {
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
 * @param dbQueryParameters -
 * @param queryFields -
 * @param regex -
 * @returns updated db query parameters
 */
const buildTerm = (
  type: string,
  dbQueryParameters: DbQueryParameters,
  queryFields: { name: string, value: string }[],
  regex: string
): DbQueryParameters => {
  const termFields = dbQueryParameters.termFields ?? [];

  queryFields.map((queryField: { name: string, value: string }) => {
    const match = queryField.name.match(regex);
    if (isNil(match)) return undefined;
    const fieldName = match[1];

    const queryParam = mapQueryStringFieldToDbField(type, { ...queryField, name: fieldName });
    return queryParam && termFields.push(queryParam);
  });
  return { ...dbQueryParameters, termFields };
};

/**
 * build terms query fields for db query parameters from query string fields
 *
 * @param type -
 * @param dbQueryParameters -
 * @param queryFields -
 * @param regex -
 * @returns updated db query parameters
 */
const buildTerms = (
  type: string,
  dbQueryParameters: DbQueryParameters,
  queryFields: { name: string, value: string }[],
  regex: string
): DbQueryParameters => {
  const termsFields = dbQueryParameters.termsFields ?? [];

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
  return { ...dbQueryParameters, termsFields };
};

const build: any = {
  // queryFields { name, value }
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

export const buildQueryParameters = (
  type: string,
  params: QueryStringParameters,
  dbQueryParameters: DbQueryParameters
) => {
  let updatedQueryParams = dbQueryParameters;
  // const sortParams = params.sortParams || { sort: build.sort(params) };
  // delete params.sortParams;

  // const { prefix: _prefix, infix: _infix } = params;

  // // Do general search
  // if (params.q) {
  //   response.query = build.general(params);
  //   return response;
  // }
  // remove reserved words (that are not fields)
  const fieldParams = omit(params, reservedWords);
  // determine which search strategy should be applied
  // options are term, terms, range, exists and not in
  const fields = Object.entries(fieldParams).map(([name, value]) => ({ name, value }));

  Object.keys(regexes).forEach((k: string) => {
    const matchedFields = fields.filter((f: any) => f.name.match(regexes[k]));

    if (matchedFields && matchedFields.length > 0 && build[k]) {
      updatedQueryParams = build[k](type, updatedQueryParams, matchedFields, regexes[k]);
    }
  });
  console.log(JSON.stringify(updatedQueryParams));

  // perform prefix and infix searches
  // build.prefix(queries, _prefix, fields);
  // build.infix(queries, _infix, fields);

  // response.query = {
  //   bool: queries,
  // };

  // return response;
};
