'use strict';

const test = require('ava');
const nock = require('nock');
const rewire = require('rewire');

const cmr = rewire('../CMR');
const validateUMMG = cmr.__get__('validateUMMG');
const ValidationError = require('../ValidationError');
const validate = require('../validate');

const cmrError = 'Granule start date [2016-01-09T11:41:12.027Z] is later than granule end date [2016-01-09T11:40:45.032Z].';

const provider = 'CUMULUS';
const granuleId = 'test-granule-Id';
const ummMetadata = { DataGranule: 'test-data' };
const xmlMetadata = '<Granule>test-data</Granule>';

const ummValidationError = {
  errors: [
    {
      path: ['Temporal'],
      errors: [cmrError]
    }
  ]
};

const xmlValidationError = `
<?xml version="1.0" encoding="UTF-8"?>
<errors><error>
  <path>Temporal</path>
  <errors>
    <error>${cmrError}</error>
  </errors>
</error></errors>`;

test.serial('CMR.validateUMMG UMMG validation succeeds', async (t) => {
  nock('https://cmr.uat.earthdata.nasa.gov')
    .post(`/ingest/providers/${provider}/validate/granule/${granuleId}`)
    .reply(200);

  process.env.CMR_ENVIRONMENT = 'UAT';

  try {
    await validateUMMG(ummMetadata, granuleId, provider);
    t.pass();
  } catch (e) {
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
  } catch (e) {
    t.true(e instanceof ValidationError);
    t.true(e.message.includes(cmrError));
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
  } catch (e) {
    t.fail('Validation error is not expected');
  }
});

test.serial('cmr-client.validate XML validation fails with error messages from CMR', async (t) => {
  nock('https://cmr.uat.earthdata.nasa.gov')
    .post(`/ingest/providers/${provider}/validate/granule/${granuleId}`)
    .reply(422, xmlValidationError);

  process.env.CMR_ENVIRONMENT = 'UAT';

  try {
    await validate('granule', xmlMetadata, granuleId, provider);
    t.fail('Expected a validation error to be thrown');
  } catch (e) {
    t.true(e instanceof ValidationError);
    t.true(e.message.includes(cmrError));
  }
});
