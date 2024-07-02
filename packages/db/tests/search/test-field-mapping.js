const test = require('ava');
const {
  mapQueryStringFieldToDbField,
} = require('../../dist/search/field-mapping');

test('mapQueryStringFieldToDbField converts an api field to db field', (t) => {
  const querStringField = { name: 'beginningDateTime', value: '2017-10-24T00:00:00.000Z' };
  const dbQueryParam = mapQueryStringFieldToDbField('granule', querStringField);
  const expectedResult = { beginning_date_time: '2017-10-24T00:00:00.000Z' };
  t.deepEqual(dbQueryParam, expectedResult);
});

test('mapQueryStringFieldToDbField returns undefined if the api field is not supported', (t) => {
  const querStringField = { name: 'apiNoMatchingDbField', value: '2017-10-24T00:00:00.000Z' };
  const dbQueryParam = mapQueryStringFieldToDbField('granule', querStringField);
  t.falsy(dbQueryParam);
});

test('mapQueryStringFieldToDbField correctly converts all granule api fields to db fields', (t) => {
  const queryStringParameters = {
    beginningDateTime: '2017-10-24T00:00:00.000Z',
    cmrLink: 'example.com',
    createdAt: '1591312763823',
    duration: '26.939',
    endingDateTime: '2017-11-08T23:59:59.000Z',
    granuleId: 'MOD09GQ.A1657416.CbyoRi.006.9697917818587',
    lastUpdateDateTime: '2018-04-25T21:45:45.524Z',
    processingEndDateTime: '2018-09-24T23:28:45.731Z',
    processingStartDateTime: '2018-09-24T22:52:34.578Z',
    productionDateTime: '2018-07-19T12:01:01Z',
    productVolume: '17956339',
    published: 'true',
    status: 'completed',
    timestamp: '1576106371369',
    timeToArchive: '5.6',
    timeToPreprocess: '10.892',
    'error.Error': 'CumulusMessageAdapterExecutionError',
    collectionId: 'MOD09GQ___006',
    provider: 's3_provider',
    pdrName: 'MOD09GQ_1granule_v3.PDR',
  };

  const expectedDbParameters = {
    beginning_date_time: '2017-10-24T00:00:00.000Z',
    cmr_link: 'example.com',
    created_at: new Date(1591312763823),
    duration: 26.939,
    ending_date_time: '2017-11-08T23:59:59.000Z',
    granule_id: 'MOD09GQ.A1657416.CbyoRi.006.9697917818587',
    last_update_date_time: '2018-04-25T21:45:45.524Z',
    processing_end_date_time: '2018-09-24T23:28:45.731Z',
    processing_start_date_time: '2018-09-24T22:52:34.578Z',
    production_date_time: '2018-07-19T12:01:01Z',
    product_volume: '17956339',
    published: true,
    status: 'completed',
    time_to_archive: 5.6,
    time_to_process: 10.892,
    updated_at: new Date(1576106371369),
    'error.Error': 'CumulusMessageAdapterExecutionError',
    collectionName: 'MOD09GQ',
    collectionVersion: '006',
    providerName: 's3_provider',
    pdrName: 'MOD09GQ_1granule_v3.PDR',
  };

  const apiFieldsList = Object.entries(queryStringParameters)
    .map(([name, value]) => ({ name, value }));
  const dbQueryParams = apiFieldsList.reduce((acc, queryField) => {
    const queryParam = mapQueryStringFieldToDbField('granule', queryField);
    return { ...acc, ...queryParam };
  }, {});
  t.deepEqual(dbQueryParams, expectedDbParameters);
});

test('mapQueryStringFieldToDbField correctly converts all asyncOperation api fields to db fields', (t) => {
  const queryStringParameters = {
    createdAt: '1591312763823',
    id: '0eb8e809-8790-5409-1239-bcd9e8d28b8e',
    operationType: 'Bulk Granule Delete',
    taskArn: 'arn:aws:ecs:us-east-1:111111111111:task/d481e76e-f5fc-9c1c-2411-fa13779b111a',
    status: 'SUCCEEDED',
    timestamp: '1591384094512',
  };

  const expectedDbParameters = {
    created_at: new Date(1591312763823),
    id: '0eb8e809-8790-5409-1239-bcd9e8d28b8e',
    operation_type: 'Bulk Granule Delete',
    task_arn: 'arn:aws:ecs:us-east-1:111111111111:task/d481e76e-f5fc-9c1c-2411-fa13779b111a',
    status: 'SUCCEEDED',
    updated_at: new Date(1591384094512),
  };

  const apiFieldsList = Object.entries(queryStringParameters)
    .map(([name, value]) => ({ name, value }));
  const dbQueryParams = apiFieldsList.reduce((acc, queryField) => {
    const queryParam = mapQueryStringFieldToDbField('asyncOperation', queryField);
    return { ...acc, ...queryParam };
  }, {});
  t.deepEqual(dbQueryParams, expectedDbParameters);
});

test('mapQueryStringFieldToDbField correctly converts all collection api fields to db fields', (t) => {
  const queryStringParameters = {
    createdAt: '1591312763823',
    name: 'MOD11A1',
    reportToEms: 'true',
    url_path: 'http://fakepath.com',
    sampleFileName: 'hello.txt',
    version: '006',
    updatedAt: 1591384094512,
  };

  const expectedDbParameters = {
    created_at: new Date(1591312763823),
    name: 'MOD11A1',
    version: '006',
    report_to_ems: true,
    url_path: 'http://fakepath.com',
    sample_file_name: 'hello.txt',
    updated_at: new Date(1591384094512),
  };

  const apiFieldsList = Object.entries(queryStringParameters)
    .map(([name, value]) => ({ name, value }));
  const dbQueryParams = apiFieldsList.reduce((acc, queryField) => {
    const queryParam = mapQueryStringFieldToDbField('collection', queryField);
    return { ...acc, ...queryParam };
  }, {});
  t.deepEqual(dbQueryParams, expectedDbParameters);
});

test('mapQueryStringFieldToDbField correctly converts all execution api fields to db fields', (t) => {
  const queryStringParameters = {
    arn: 'https://example.com/arn',
    createdAt: '1591312763823',
    execution: 'https://example.com',
    status: 'completed',
    updatedAt: 1591384094512,
    collectionId: 'MOD09GQ___006',
  };

  const expectedDbParameters = {
    arn: 'https://example.com/arn',
    created_at: new Date(1591312763823),
    url: 'https://example.com',
    status: 'completed',
    updated_at: new Date(1591384094512),
    collectionName: 'MOD09GQ',
    collectionVersion: '006',
  };

  const apiFieldsList = Object.entries(queryStringParameters)
    .map(([name, value]) => ({ name, value }));
  const dbQueryParams = apiFieldsList.reduce((acc, queryField) => {
    const queryParam = mapQueryStringFieldToDbField('execution', queryField);
    return { ...acc, ...queryParam };
  }, {});
  t.deepEqual(dbQueryParams, expectedDbParameters);
});

test('mapQueryStringFieldToDbField correctly converts all pdr api fields to db fields', (t) => {
  const queryStringParameters = {
    createdAt: '1591312763823',
    pdrName: 'fakePdrName',
    status: 'completed',
    updatedAt: 1591384094512,
    collectionId: 'MOD09GQ___006',
    provider: 's3_provider',
  };

  const expectedDbParameters = {
    created_at: new Date(1591312763823),
    name: 'fakePdrName',
    status: 'completed',
    updated_at: new Date(1591384094512),
    collectionName: 'MOD09GQ',
    collectionVersion: '006',
    providerName: 's3_provider',
  };

  const apiFieldsList = Object.entries(queryStringParameters)
    .map(([name, value]) => ({ name, value }));
  const dbQueryParams = apiFieldsList.reduce((acc, queryField) => {
    const queryParam = mapQueryStringFieldToDbField('pdr', queryField);
    return { ...acc, ...queryParam };
  }, {});
  t.deepEqual(dbQueryParams, expectedDbParameters);
});

test('mapQueryStringFieldToDbField correctly converts all provider api fields to db fields', (t) => {
  const queryStringParameters = {
    createdAt: '1591312763823',
    id: 'fakeProviderId',
    updatedAt: 1591384094512,
  };

  const expectedDbParameters = {
    created_at: new Date(1591312763823),
    name: 'fakeProviderId',
    updated_at: new Date(1591384094512),
  };

  const apiFieldsList = Object.entries(queryStringParameters)
    .map(([name, value]) => ({ name, value }));
  const dbQueryParams = apiFieldsList.reduce((acc, queryField) => {
    const queryParam = mapQueryStringFieldToDbField('provider', queryField);
    return { ...acc, ...queryParam };
  }, {});
  t.deepEqual(dbQueryParams, expectedDbParameters);
});

test('mapQueryStringFieldToDbField correctly converts all rule api fields to db fields', (t) => {
  const queryStringParameters = {
    createdAt: '1591312763823',
    name: 'fakePdrName',
    state: 'DISABLED',
    updatedAt: 1591384094512,
    collectionId: 'MOD09GQ___006',
    provider: 's3_provider',
  };

  const expectedDbParameters = {
    created_at: new Date(1591312763823),
    name: 'fakePdrName',
    enabled: false,
    updated_at: new Date(1591384094512),
    collectionName: 'MOD09GQ',
    collectionVersion: '006',
    providerName: 's3_provider',
  };

  const apiFieldsList = Object.entries(queryStringParameters)
    .map(([name, value]) => ({ name, value }));
  const dbQueryParams = apiFieldsList.reduce((acc, queryField) => {
    const queryParam = mapQueryStringFieldToDbField('rule', queryField);
    return { ...acc, ...queryParam };
  }, {});
  t.deepEqual(dbQueryParams, expectedDbParameters);
});
