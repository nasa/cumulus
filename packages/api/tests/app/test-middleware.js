'use strict';

const test = require('ava');
const sinon = require('sinon');

const { buildFakeExpressResponse } = require('../endpoints/utils');
const { validateApiVersionCompliance } = require('../../app/middleware');

test('validateApiVersionCompliance returns 400 if request version is less than minVersion', (t) => {
  const minVersion = 4;
  const response = buildFakeExpressResponse();
  const fakeReq = { headers: { 'cumulus-api-version': 2 } };
  const nextStub = sinon.stub();

  validateApiVersionCompliance(minVersion)(fakeReq, response, nextStub);
  t.is(response.status.getCall(0).args[0], 400);
  t.is(
    response.status().send.getCall(0).args[0].error,
    `This API endpoint requires \'version\' header to be an integer set to at least ${minVersion}.  Please ensure your request is compatible with that version of the API and update your request accordingly`
  );
  t.false(nextStub.calledOnce);
});

test('validateApiVersionCompliance calls next if request version is equal to minVersion', (t) => {
  const minVersion = 2;
  const response = buildFakeExpressResponse();
  const fakeReq = { headers: { 'cumulus-api-version': 2 } };
  const nextStub = sinon.stub();

  validateApiVersionCompliance(minVersion)(fakeReq, response, nextStub);
  t.false(response.status.calledOnce);
  t.false(response.status().send.calledOnce);
  t.true(nextStub.calledOnce);
});

test('validateApiVersionCompliance calls next if request version is greater than minVersion', (t) => {
  const minVersion = 2;
  const response = buildFakeExpressResponse();
  const fakeReq = { headers: { 'cumulus-api-version': 4 } };
  const nextStub = sinon.stub();

  validateApiVersionCompliance(minVersion)(fakeReq, response, nextStub);
  t.false(response.status.calledOnce);
  t.false(response.status().send.calledOnce);
  t.true(nextStub.calledOnce);
});
