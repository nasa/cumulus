const test = require('ava');
const {
  convertQueryStringToDbQueryParameters,
} = require('../../dist/search/queries');

test('convertQueryStringToDbQueryParameters correctly converts api query string parameters to db query parameters', (t) => {
  const queryStringParameters = {
    duration__from: 25,
    fields: 'granuleId,collectionId,status,updatedAt',
    infix: 'A1657416',
    limit: 20,
    page: 3,
    prefix: 'MO',
    sort_key: ['-productVolume', '+timestamp'],
    published: 'true',
    status: 'completed',
    timestamp__from: '1712708508310',
    timestamp__to: '1712712108310',
    'error.Error': 'CumulusMessageAdapterExecutionError',
    collectionId: 'MOD09GQ___006',
    nonExistingField: 'nonExistingFieldValue',
    nonExistingField__from: 'nonExistingFieldValue',
    granuleId__in: 'granuleId1,granuleId2',
    collectionId__in: 'MOD09GQ___006,MODIS___007',
    granuleId__not: 'notMatchingGranuleId',
    error__exists: 'true',
  };

  const expectedDbQueryParameters = {
    exists: {
      error: true,
    },
    fields: ['granuleId', 'collectionId', 'status', 'updatedAt'],
    infix: 'A1657416',
    limit: 20,
    not: {
      granule_id: 'notMatchingGranuleId',
    },
    offset: 40,
    page: 3,
    prefix: 'MO',
    sort: [{
      column: 'product_volume',
      order: 'desc',
    },
    {
      column: 'updated_at',
      order: 'asc',
    }],
    range: {
      duration: {
        gte: queryStringParameters.duration__from,
      },
      updated_at: {
        gte: new Date(Number(queryStringParameters.timestamp__from)),
        lte: new Date(Number(queryStringParameters.timestamp__to)),
      },
    },
    term: {
      collectionName: 'MOD09GQ',
      collectionVersion: '006',
      published: true,
      status: 'completed',
      'error.Error': 'CumulusMessageAdapterExecutionError',
    },
    terms: {
      granule_id: ['granuleId1', 'granuleId2'],
      collectionName: ['MOD09GQ', 'MODIS'],
      collectionVersion: ['006', '007'],
    },
  };

  const dbQueryParams = convertQueryStringToDbQueryParameters('granule', queryStringParameters);
  t.deepEqual(dbQueryParams, expectedDbQueryParameters);
});

test('convertQueryStringToDbQueryParameters correctly converts sortby error parameter to db query parameters', (t) => {
  const queryStringParameters = {
    sort_by: 'error.Error.keyword',
    order: 'asc',
  };

  const expectedDbQueryParameters = {
    limit: 10,
    offset: 0,
    page: 1,
    sort: [
      {
        column: 'error.Error',
        order: 'asc',
      },
    ],
  };

  const dbQueryParams = convertQueryStringToDbQueryParameters('granule', queryStringParameters);
  t.deepEqual(dbQueryParams, expectedDbQueryParameters);
});
