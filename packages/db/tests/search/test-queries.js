const test = require('ava');
const {
  convertQueryStringToDbQueryParameters,
} = require('../../dist/search/queries');

test('convertQueryStringToDbQueryParameters correctly converts api query string parameters to db query parameters', (t) => {
  const queryStringParameters = {
    fields: 'granuleId,collectionId,status,updatedAt',
    infix: 'A1657416',
    limit: 20,
    page: 3,
    prefix: 'MO',
    published: 'true',
    status: 'completed',
    
    'error.Error': 'CumulusMessageAdapterExecutionError',
    collectionId: 'MOD09GQ___006',
    nonExistingField: 'nonExistingFieldValue',
  };

  const expectedDbQueryParameters = {
    fields: ['granuleId', 'collectionId', 'status', 'updatedAt'],
    infix: 'A1657416',
    limit: 20,
    offset: 40,
    page: 3,
    prefix: 'MO',
    term: {
      collectionName: 'MOD09GQ',
      collectionVersion: '006',
      published: true,
      status: 'completed',
      'error.Error': 'CumulusMessageAdapterExecutionError',
    },
  };

  const dbQueryParams = convertQueryStringToDbQueryParameters('granule', queryStringParameters);
  t.deepEqual(dbQueryParams, expectedDbQueryParameters);
});
