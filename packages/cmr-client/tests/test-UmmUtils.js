'use strict';

const test = require('ava');
const nock = require('nock');
const ValidationError = require('../ValidationError');
const validate = require('../validate');
const { ummVersion, validateUMMG } = require('../UmmUtils');

const cmrError = 'Granule start date [2016-01-09T11:41:12.027Z] is later than granule end date [2016-01-09T11:40:45.032Z].';

const provider = 'CUMULUS';
const granuleId = 'test-granule-Id';
const ummMetadata = { DataGranule: 'test-data' };
const xmlMetadata = '<Granule>test-data</Granule>';

const ummValidationError = {
  errors: [
    {
      path: ['Temporal'],
      errors: [cmrError],
    },
  ],
};

test.before(() => {
  nock.disableNetConnect();
  nock.enableNetConnect(/(localhost|127.0.0.1)/);
});

test.afterEach.always(() => {
  nock.cleanAll();
});

test.after.always(() => {
  nock.enableNetConnect();
});

test.serial('CMR.validateUMMG UMMG validation succeeds', async (t) => {
  nock('https://cmr.uat.earthdata.nasa.gov')
    .post(`/ingest/providers/${provider}/validate/granule/${granuleId}`)
    .reply(200);

  process.env.CMR_ENVIRONMENT = 'UAT';

  try {
    await validateUMMG(ummMetadata, granuleId, provider);
    t.pass();
  } catch (error) {
    t.fail('Validation error is not expected');
  }
});

test.serial('CMR.validateUMMG UMMG validation fails with error messages from CMR', async (t) => {
  nock('https://cmr.uat.earthdata.nasa.gov')
    .post(`/ingest/providers/${provider}/validate/granule/${granuleId}`)
    .reply(422, ummValidationError);

  process.env.CMR_ENVIRONMENT = 'UAT';

  try {
    await validateUMMG(ummMetadata, granuleId, provider);
    t.fail('Expected a validation error to be thrown');
  } catch (error) {
    t.true(error instanceof ValidationError);
    t.true(error.message.includes(cmrError));
  }
});

test.serial('cmr-client.validate XML validation succeeds', async (t) => {
  nock('https://cmr.uat.earthdata.nasa.gov')
    .post(`/ingest/providers/${provider}/validate/granule/${granuleId}`)
    .reply(200);

  process.env.CMR_ENVIRONMENT = 'UAT';

  try {
    await validate('granule', xmlMetadata, granuleId, provider);
    t.pass();
  } catch (error) {
    t.fail('Validation error is not expected');
  }
});

test.serial('cmr-client.validate XML validation fails with error messages from CMR', async (t) => {
  const xmlValidationError = `
<?xml version="1.0" encoding="UTF-8"?>
<errors><error>
  <path>Temporal</path>
  <errors>
    <error>${cmrError}</error>
  </errors>
</error></errors>`;

  nock('https://cmr.uat.earthdata.nasa.gov')
    .post(`/ingest/providers/${provider}/validate/granule/${granuleId}`)
    .reply(422, xmlValidationError);

  process.env.CMR_ENVIRONMENT = 'UAT';

  try {
    await validate('granule', xmlMetadata, granuleId, provider);
    t.fail('Expected a validation error to be thrown');
  } catch (error) {
    t.true(error instanceof ValidationError);
    t.true(error.message.includes(cmrError));
  }
});

test.serial('validateUMMG calls post with correct metadata version when metadata version available', async (t) => {
  const identifier = 'fakeIdentifier';
  const metadata = {
    restOfMetadataUpHere: 'still fake',
    MetadataSpecification: {
      URL: 'https://cdn.earthdata.nasa.gov/umm/granule/v1.5',
      Name: 'UMM-G',
      Version: '1.5',
    },
  };

  nock('https://cmr.uat.earthdata.nasa.gov')
    .matchHeader('Accept', 'application/json')
    .matchHeader('Content-type', 'application/vnd.nasa.cmr.umm+json;version=1.5')
    .post(`/ingest/providers/${provider}/validate/granule/${identifier}`)
    .reply(200);

  process.env.CMR_ENVIRONMENT = 'UAT';
  await validateUMMG(metadata, identifier, provider);

  t.true(nock.isDone());
});

test.serial('validateUMMG calls post with default version (1.4) when metadata version unavailable', async (t) => {
  const identifier = 'fakeIdentifier';
  const metadata = {
    restOfMetadataUpHere: 'still fake',
    MissingMetadataSpecification: 'nothing here',
  };

  nock('https://cmr.uat.earthdata.nasa.gov')
    .matchHeader('Accept', 'application/json')
    .matchHeader('Content-type', 'application/vnd.nasa.cmr.umm+json;version=1.4')
    .post(`/ingest/providers/${provider}/validate/granule/${identifier}`)
    .reply(200);

  process.env.CMR_ENVIRONMENT = 'UAT';
  await validateUMMG(metadata, identifier, provider);

  t.true(nock.isDone());
});

test('ummVersion returns UMM version if found on metadata object.', (t) => {
  const metadata = {
    restOfMetadataUpHere: 'it is all fake',
    MetadataSpecification: {
      URL: 'https://cdn.earthdata.nasa.gov/umm/granule/v1.5',
      Name: 'UMM-G',
      Version: '1.5',
    },
  };

  t.is(ummVersion(metadata), '1.5');
});

test('ummVersion returns default version 1.4 if object has no metadata specification.', (t) => {
  const metadata = {
    restOfMetadataUpHere: 'still fake',
    MissingMetadataSpecification: 'nothing here',
  };

  t.is(ummVersion(metadata), '1.4');
});
