'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { randomId } = require('@cumulus/common/test-utils');
const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');

const sandbox = sinon.createSandbox();
const fakeListRequests = sandbox.stub();

const orca = proxyquire('../../lib/orca', {
  '@cumulus/api-client/orca': { listRequests: fakeListRequests },
});

const recoveryRequestFactory = (options) => (
  {
    granule_id: options.granuleId || randomId('granuleId'),
    object_key: randomId('objectKey'),
    job_type: 'restore',
    job_status: options.status || 'inprogress',
  });

test.afterEach.always(() => {
  sandbox.reset();
});

test.after.always(() => {
  sandbox.restore();
});

test.serial(
  'getOrcaRecoveryStatusByGranuleId returns undefined status when orca endpoint returns error',
  async (t) => {
    const granuleId = randomId('granId');
    fakeListRequests.resolves({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Function not found: prefix_request_status, please check if orca is deployed',
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleId(granuleId);
    t.is(status, undefined);
  }
);

test.serial(
  'getOrcaRecoveryStatusByGranuleId returns undefined status when recovery request for granule is not found',
  async (t) => {
    const granuleId = randomId('granId');
    const recoveryRequests = [];
    fakeListRequests.resolves({
      body: JSON.stringify(recoveryRequests),
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleId(granuleId);
    t.is(status, undefined);
  }
);

test.serial(
  'getOrcaRecoveryStatusByGranuleId returns running status when files are still in progress',
  async (t) => {
    const granuleId = randomId('granId');
    const recoveryRequests = [
      recoveryRequestFactory({ granuleId, status: 'complete' }),
      recoveryRequestFactory({ granuleId, status: 'inprogress' }),
      recoveryRequestFactory({ granuleId, status: 'error' }),
    ];
    fakeListRequests.resolves({
      body: JSON.stringify(recoveryRequests),
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleId(granuleId);
    t.is(status, 'running');
  }
);

test.serial(
  'getOrcaRecoveryStatusByGranuleId returns running status when files are complete',
  async (t) => {
    const granuleId = randomId('granId');
    const recoveryRequests = [
      recoveryRequestFactory({ granuleId, status: 'complete' }),
      recoveryRequestFactory({ granuleId, status: 'complete' }),
    ];
    fakeListRequests.resolves({
      body: JSON.stringify(recoveryRequests),
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleId(granuleId);
    t.is(status, 'completed');
  }
);

test.serial(
  'getOrcaRecoveryStatusByGranuleId returns running status when file restore has error',
  async (t) => {
    const granuleId = randomId('granId');
    const recoveryRequests = [
      recoveryRequestFactory({ granuleId, status: 'complete' }),
      recoveryRequestFactory({ granuleId, status: 'error' }),
    ];
    fakeListRequests.resolves({
      body: JSON.stringify(recoveryRequests),
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleId(granuleId);
    t.is(status, 'failed');
  }
);

test.serial(
  'addOrcaRecoveryStatus adds recovery status to granules',
  async (t) => {
    const granuleIds = [randomId('granId'), randomId('granId')];
    const inputResponse = {
      results: [
        fakeGranuleFactoryV2({ granuleId: granuleIds[0] }),
        fakeGranuleFactoryV2({ granuleId: granuleIds[1] })],
    };
    const recoveryRequestsGranule1 = [
      recoveryRequestFactory({ granuleId: granuleIds[0], status: 'inprogress' }),
      recoveryRequestFactory({ granuleId: granuleIds[0], status: 'inprogress' }),
    ];

    const recoveryRequestsGranule2 = [
      recoveryRequestFactory({ granuleId: granuleIds[1], status: 'complete' }),
      recoveryRequestFactory({ granuleId: granuleIds[1], status: 'error' }),
    ];

    fakeListRequests.onCall(0)
      .returns({ body: JSON.stringify(recoveryRequestsGranule1) });
    fakeListRequests.onCall(1)
      .returns({ body: JSON.stringify(recoveryRequestsGranule2) });

    const updatedResponse = await orca.addOrcaRecoveryStatus(inputResponse);
    const granules = updatedResponse.results;
    t.is(granules.length, 2);
    t.is(granules[0].recoveryStatus, 'running');
    t.is(granules[1].recoveryStatus, 'failed');
  }
);
