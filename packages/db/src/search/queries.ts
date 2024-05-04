import omit from 'lodash/omit';
import { deconstructCollectionId } from '@cumulus/message/Collections';
import { DbQueryParameters, QueryStringParameters } from '../types/search';

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

// mapping the api granule search fields to postgres db fields
const granuleMapping: any = {
  beginningDateTime: (value: string) => ({
    beginning_date_time: value,
  }),
  cmrLink: (value: string) => ({
    cmr_link: value,
  }),
  createdAt: (value: string) => ({
    created_at: new Date(Number(value)),
  }),
  duration: (value: string) => ({
    duration: Number(value),
  }),
  endingDateTime: (value: string) => ({
    ending_date_time: value,
  }),
  granuleId: (value: string) => ({
    granule_id: value,
  }),
  lastUpdateDateTime: (value: string) => ({
    last_update_date_time: value,
  }),
  processingEndDateTime: (value: string) => ({
    processing_end_date_time: value,
  }),
  processingStartDateTime: (value: string) => ({
    processing_start_date_time: value,
  }),
  productionDateTime: (value: string) => ({
    production_date_time: value,
  }),
  productVolume: (value: string) => ({
    product_volume: Number(value),
  }),
  published: (value: string) => ({
    published: value,
  }),
  status: (value: string) => ({
    status: value,
  }),
  timestamp: (value: string) => ({
    timestamp: new Date(Number(value)),
  }),
  timeToArchive: (value: string) => ({
    time_to_archive: Number(value),
  }),
  timeToPreprocess: (value: string) => ({
    time_to_process: Number(value),
  }),
  updatedAt: (value: string) => ({
    updated_at: new Date(Number(value)),
  }),
  // The following fields require querying other tables
  collectionId: (value: string) => {
    const { name, version } = deconstructCollectionId(value);
    return {
      collectionName: name,
      collectionVersion: version,
    };
  },
  provider: (value: string) => ({
    providerName: value,
  }),
  pdrName: (value: string) => ({
    pdrName: value,
  }),
};

const buildTerm = (type: string, dbQueryParameters: DbQueryParameters, queryFields: any, regex: any)
: DbQueryParameters => {
  const termFields = dbQueryParameters.termFields ?? [];
  queryFields.map((field: any) => {
    const fieldName = field.name.match(regex)[1];
    if (granuleMapping[fieldName]) {
      const queryParam = granuleMapping[fieldName](field.value);
      termFields.push(queryParam);
      return queryParam;
    }
    console.log(fieldName, 'is not querable');
    return undefined;
  });
  return { ...dbQueryParameters, termFields };
};

const buildTerms = (
  type: string, dbQueryParameters: DbQueryParameters, queryFields: any, regex: any
)
: DbQueryParameters => {
  const termsFields = dbQueryParameters.termsFields ?? [];
  queryFields.map((field: any) => {
    const fieldName = field.name.match(regex)[1];
    if (granuleMapping[fieldName]) {
      const mappedFields = field.value.split(',').map((val: any) => granuleMapping[fieldName](val));
      const queryParam = {
        name: mappedFields[0].name,
        value: mappedFields.map((f: any) => f.value).join(','),
      };
      termsFields.push(queryParam);
      return queryParam;
    }
    console.log(fieldName, 'is not querable');
    return undefined;
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
