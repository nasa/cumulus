const test = require('ava');
const {
  convertQueryStringToDbQueryParameters,
} = require('../../dist/search/queries');

test('convertQueryStringToDbQueryParameters correctly converts api query string parameters to db query parameters', (t) => {
  const queryStringParameters = {
    duration__from: '25',
    fields: 'granuleId,collectionId,status,updatedAt',
    infix: 'A1657416',
    limit: '20',
    page: '3',
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
    includeActiveState: 'true',
    includeFullRecord: 'true',
  };

  const expectedDbQueryParameters = {
    countOnly: false,
    estimateTableRowCount: false,
    exists: {
      error: true,
    },
    fields: ['granuleId', 'collectionId', 'status', 'updatedAt'],
    infix: 'A1657416',
    includeActiveState: true,
    includeFullRecord: true,
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
    },
    {
      column: 'cumulus_id',
      order: 'asc',
    }],
    range: {
      duration: {
        gte: Number(queryStringParameters.duration__from),
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

test('convertQueryStringToDbQueryParameters does not include limit/offset parameters if limit is explicitly set to null', (t) => {
  const queryStringParameters = {
    limit: 'null',
    offset: '3',
  };
  const dbQueryParams = convertQueryStringToDbQueryParameters('granule', queryStringParameters);
  t.is(dbQueryParams.limit, undefined);
  t.is(dbQueryParams.offset, undefined);
});

test('convertQueryStringToDbQueryParameters adds limit and sorting on cumulus_id to db query parameters by default', (t) => {
  const expectedDbQueryParameters = {
    countOnly: false,
    estimateTableRowCount: false,
    limit: 10,
    offset: 0,
    page: 1,
    includeActiveState: false,
    includeFullRecord: false,
    sort: [
      {
        column: 'cumulus_id',
        order: 'asc',
      },
    ],
  };
  const dbQueryParams = convertQueryStringToDbQueryParameters('granule', {});
  t.deepEqual(dbQueryParams, expectedDbQueryParameters);
});

test('convertQueryStringToDbQueryParameters adds sorting on cumulus_id to db query parameters if limit is not set to null and sort_key is provided', (t) => {
  const queryStringParameters = {
    sort_key: ['-productVolume'],
  };
  const expectedSortParameter = [
    {
      column: 'product_volume',
      order: 'desc',
    },
    {
      column: 'cumulus_id',
      order: 'asc',
    },
  ];
  const dbQueryParams = convertQueryStringToDbQueryParameters('granule', queryStringParameters);
  t.deepEqual(dbQueryParams.sort, expectedSortParameter);
});

test('convertQueryStringToDbQueryParameters adds sorting on cumulus_id to db query parameters if limit is not set to null and sort_by is provided', (t) => {
  const queryStringParameters = {
    sort_by: 'productVolume',
    order: 'desc',
  };
  const expectedSortParameter = [
    {
      column: 'product_volume',
      order: 'desc',
    },
    {
      column: 'cumulus_id',
      order: 'asc',
    },
  ];
  const dbQueryParams = convertQueryStringToDbQueryParameters('granule', queryStringParameters);
  t.deepEqual(dbQueryParams.sort, expectedSortParameter);
});

test('convertQueryStringToDbQueryParameters does not add sorting on cumulus_id to db query parameters if limit is set to null and sort_key is provided', (t) => {
  const queryStringParameters = {
    limit: 'null',
    sort_key: ['-productVolume'],
  };
  const expectedSortParameter = [
    {
      column: 'product_volume',
      order: 'desc',
    },
  ];
  const dbQueryParams = convertQueryStringToDbQueryParameters('granule', queryStringParameters);
  t.deepEqual(dbQueryParams.sort, expectedSortParameter);
});

test('convertQueryStringToDbQueryParameters does not add sorting on cumulus_id to db query parameters if limit is set to null and sort_by is provided', (t) => {
  const queryStringParameters = {
    limit: 'null',
    sort_by: 'productVolume',
    order: 'desc',
  };
  const expectedSortParameter = [
    {
      column: 'product_volume',
      order: 'desc',
    },
  ];
  const dbQueryParams = convertQueryStringToDbQueryParameters('granule', queryStringParameters);
  t.deepEqual(dbQueryParams.sort, expectedSortParameter);
});

test('convertQueryStringToDbQueryParameters correctly converts sortby error parameter to db query parameters', (t) => {
  const queryStringParameters = {
    sort_by: 'error.Error.keyword',
    order: 'asc',
  };

  const expectedDbQueryParameters = {
    countOnly: false,
    estimateTableRowCount: false,
    limit: 10,
    offset: 0,
    page: 1,
    includeActiveState: false,
    includeFullRecord: false,
    sort: [
      {
        column: 'error.Error',
        order: 'asc',
      },
      {
        column: 'cumulus_id',
        order: 'asc',
      },
    ],
  };

  const dbQueryParams = convertQueryStringToDbQueryParameters('granule', queryStringParameters);
  t.deepEqual(dbQueryParams, expectedDbQueryParameters);
});
