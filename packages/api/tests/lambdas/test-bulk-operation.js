const test = require('ava');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const { randomId } = require('@cumulus/common/test-utils');

const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');
const Granule = require('../../models/granules');

const sandbox = sinon.createSandbox();
const FakeEsClient = sandbox.stub();
const esSearchStub = sandbox.stub();
FakeEsClient.prototype.search = esSearchStub;
const bulkOperation = proxyquire('../../lambdas/bulk-operation', {
  '@elastic/elasticsearch': { Client: FakeEsClient }
});

let applyWorkflowStub;
let deleteStub;

test.before(async () => {
  process.env.METRICS_ES_HOST = randomId('host');
  process.env.METRICS_ES_USER = randomId('user');
  process.env.METRICS_ES_PASS = randomId('pass');

  process.env.GranulesTable = randomId('granule');
  await new Granule().createTable();

  applyWorkflowStub = sandbox.stub(Granule.prototype, 'applyWorkflow');
  deleteStub = sandbox.stub(Granule.prototype, 'delete');
});

test.afterEach.always(() => {
  sandbox.resetHistory();
});

test.after.always(() => {
  sandbox.restore();
});

test.todo('getGranuleIdsForPayload returns granule IDs from query');
test.todo('getGranuleIdsForPayload handles paging');

test.serial('bulk operation lambda applies workflow to list of granule IDs', async (t) => {
  const granuleModel = new Granule();
  const granules = await Promise.all([
    granuleModel.create(fakeGranuleFactoryV2()),
    granuleModel.create(fakeGranuleFactoryV2())
  ]);

  const workflowName = randomId('workflow');
  await bulkOperation.handler({
    type: 'BULK_GRANULE',
    payload: {
      ids: [
        granules[0].granuleId,
        granules[1].granuleId
      ],
      workflowName
    }
  });
  t.is(applyWorkflowStub.callCount, 2);
  // Can't guarantee processing order so test against granule matching by ID
  applyWorkflowStub.args.forEach((callArgs) => {
    const matchingGranule = granules.find((granule) => granule.granuleId === callArgs[0].granuleId);
    t.deepEqual(matchingGranule, callArgs[0]);
    t.is(callArgs[1], workflowName);
  });
});

test.serial('bulk operation lambda applies workflow to granule IDs returned by query', async (t) => {
  const granuleModel = new Granule();
  const granules = await Promise.all([
    granuleModel.create(fakeGranuleFactoryV2()),
    granuleModel.create(fakeGranuleFactoryV2())
  ]);

  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granules[0].granuleId
          }
        }, {
          _source: {
            granuleId: granules[1].granuleId
          }
        }],
        total: {
          value: 2
        }
      }
    }
  });

  const workflowName = randomId('workflow');
  await bulkOperation.handler({
    type: 'BULK_GRANULE',
    payload: {
      query: 'fake-query',
      workflowName,
      index: randomId('index')
    }
  });

  t.true(esSearchStub.called);
  t.is(applyWorkflowStub.callCount, 2);
  // Can't guarantee processing order so test against granule matching by ID
  applyWorkflowStub.args.forEach((callArgs) => {
    const matchingGranule = granules.find((granule) => granule.granuleId === callArgs[0].granuleId);
    t.deepEqual(matchingGranule, callArgs[0]);
    t.is(callArgs[1], workflowName);
  });
});

test.serial('bulk operation lambda deletes listed granule IDs', async (t) => {
  const granuleModel = new Granule();
  const granules = await Promise.all([
    granuleModel.create(fakeGranuleFactoryV2({ published: false })),
    granuleModel.create(fakeGranuleFactoryV2({ published: false }))
  ]);

  await bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    payload: {
      ids: [
        granules[0].granuleId,
        granules[1].granuleId
      ]
    }
  });

  t.is(deleteStub.callCount, 2);
  // Can't guarantee processing order so ensure all IDs were deleted
  const deletedIds = deleteStub.args.map((callArgs) => callArgs[0].granuleId);
  t.deepEqual(deletedIds, [
    granules[0].granuleId,
    granules[1].granuleId
  ]);
});

test.serial('bulk operation lambda deletes granule IDs returned by query', async (t) => {
  const granuleModel = new Granule();
  const granules = await Promise.all([
    granuleModel.create(fakeGranuleFactoryV2({ published: false })),
    granuleModel.create(fakeGranuleFactoryV2({ published: false }))
  ]);

  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granules[0].granuleId
          }
        }, {
          _source: {
            granuleId: granules[1].granuleId
          }
        }],
        total: {
          value: 2
        }
      }
    }
  });

  await bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    payload: {
      query: 'fake-query',
      index: randomId('index')
    }
  });

  t.true(esSearchStub.called);
  t.is(deleteStub.callCount, 2);
  // Can't guarantee processing order so ensure all IDs were deleted
  const deletedIds = deleteStub.args.map((callArgs) => callArgs[0].granuleId);
  t.deepEqual(deletedIds, [
    granules[0].granuleId,
    granules[1].granuleId
  ]);
});
