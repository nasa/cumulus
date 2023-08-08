'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { randomId } = require('@cumulus/common/test-utils');
const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');

process.env.orca_api_uri = 'fake_orca_api_uri';
const sandbox = sinon.createSandbox();
const fakePostToOrca = sandbox.stub();
const orca = proxyquire('../../lib/orca', {
  got: {
    post: fakePostToOrca,
  },
});

const recoveryRequestFactory = (options) => (
  {
    granule_id: options.granuleId || randomId('granuleId'),
    files: options.files
    || [
      {
        file_name: randomId('file_name'),
        status: options.status || 'inprogress',
      },
    ],
  });

test.afterEach.always(() => {
  sandbox.reset();
});

test.after.always(() => {
  sandbox.restore();
});

const collectionId = randomId('collectionId');

test.serial(
  'getOrcaRecoveryStatusByGranuleIdAndCollection returns undefined status when orca endpoint returns error',
  async (t) => {
    const granuleId = randomId('granId');
    fakePostToOrca.resolves({
      statusCode: 400,
      body: {
        httpStatus: 400,
        error: 'Bad Request',
        message: 'Function not found: prefix_request_status, please check if orca is deployed',
      },
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleIdAndCollection(
      granuleId,
      collectionId
    );
    t.is(status, undefined);
  }
);

test.serial(
  'getOrcaRecoveryStatusByGranuleIdAndCollection returns undefined status when recovery request for granule is not found',
  async (t) => {
    const granuleId = randomId('granId');
    fakePostToOrca.resolves({
      statusCode: 404,
      body: {
        httpStatus: 404,
        errorType: 'NotFound',
        message: 'No granules found',
      },
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleIdAndCollection(
      granuleId,
      collectionId
    );
    t.is(status, undefined);
  }
);

test.serial(
  'getOrcaRecoveryStatusByGranuleIdAndCollection returns running status when files are still in progress',
  async (t) => {
    const granuleId = randomId('granId');
    const files = [
      {
        file_name: randomId('file_name'),
        status: 'success',
      },
      {
        file_name: randomId('file_name'),
        status: 'pending',
      },
      {
        file_name: randomId('file_name'),
        status: 'failed',
      },
    ];
    const recoveryRequests = recoveryRequestFactory({ granuleId, files });
    fakePostToOrca.resolves({
      statusCode: 200,
      body: recoveryRequests,
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleIdAndCollection(
      granuleId,
      collectionId
    );
    t.is(status, 'running');
  }
);

test.serial(
  'getOrcaRecoveryStatusByGranuleIdAndCollection returns completed status when files are success',
  async (t) => {
    const granuleId = randomId('granId');
    const files = [
      {
        file_name: randomId('file_name'),
        status: 'success',
      },
      {
        file_name: randomId('file_name'),
        status: 'success',
      },
    ];
    const recoveryRequests = recoveryRequestFactory({ granuleId, files });
    fakePostToOrca.resolves({
      statusCode: 200,
      body: recoveryRequests,
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleIdAndCollection(
      granuleId,
      collectionId
    );
    t.is(status, 'completed');
  }
);

test.serial(
  'getOrcaRecoveryStatusByGranuleIdAndCollection returns failed status when file restore has error',
  async (t) => {
    const granuleId = randomId('granId');
    const files = [
      {
        file_name: randomId('file_name'),
        status: 'success',
      },
      {
        file_name: randomId('file_name'),
        status: 'failed',
      },
    ];
    const recoveryRequests = recoveryRequestFactory({ granuleId, files });
    fakePostToOrca.resolves({
      statusCode: 200,
      body: recoveryRequests,
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleIdAndCollection(
      granuleId,
      collectionId
    );
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
    const filesForGranule1 = [
      {
        file_name: randomId('file_name'),
        status: 'pending',
      },
      {
        file_name: randomId('file_name'),
        status: 'staged',
      },
    ];
    const filesForGranule2 = [
      {
        file_name: randomId('file_name'),
        status: 'success',
      },
      {
        file_name: randomId('file_name'),
        status: 'failed',
      },
    ];
    const recoveryRequestsGranule1 = recoveryRequestFactory({
      granuleId: granuleIds[0], files: filesForGranule1,
    });

    const recoveryRequestsGranule2 = recoveryRequestFactory({
      granuleId: granuleIds[1], files: filesForGranule2,
    });

    fakePostToOrca.onCall(0)
      .returns({ statusCode: 200, body: recoveryRequestsGranule1 });
    fakePostToOrca.onCall(1)
      .returns({ statusCode: 200, body: recoveryRequestsGranule2 });

    const updatedResponse = await orca.addOrcaRecoveryStatus(inputResponse);
    const granules = updatedResponse.results;
    t.is(granules.length, 2);
    t.is(granules[0].recoveryStatus, 'running');
    t.is(granules[1].recoveryStatus, 'failed');
  }
);
