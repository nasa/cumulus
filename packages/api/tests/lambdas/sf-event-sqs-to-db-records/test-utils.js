'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const uuidv4 = require('uuid/v4');

const sandbox = sinon.createSandbox();
const stubRecordExists = sandbox.stub().resolves(true);

const {
  isPostRDSDeploymentExecution,
  hasNoAsyncOpOrExists,
  hasNoParentExecutionOrExists,
  getMessageAsyncOperationCumulusId,
  getMessageParentExecutionCumulusId,
  getMessageCollectionCumulusId,
  getMessageProviderCumulusId,
} = proxyquire('../../../lambdas/sf-event-sqs-to-db-records/utils', {
  '@cumulus/db': {
    doesRecordExist: stubRecordExists,
  },
});

test.beforeEach((t) => {
  t.context.rdsDeploymentVersion = '3.0.0';
  process.env.RDS_DEPLOYMENT_CUMULUS_VERSION = t.context.rdsDeploymentVersion;
  t.context.postRDSDeploymentVersion = '4.0.0';
  t.context.preRDSDeploymentVersion = '2.9.99';

  t.context.doesRecordExistStub = stubRecordExists;
  t.context.doesRecordExistStub.resetHistory();

  t.context.asyncOperation = {
    id: cryptoRandomString({ length: 5 }),
  };
  t.context.collection = {
    name: cryptoRandomString({ length: 5 }),
    version: '0.0.0',
  };
  t.context.provider = {
    id: cryptoRandomString({ length: 5 }),
  };
  t.context.parentExecutionArn = cryptoRandomString({ length: 5 });
  t.context.cumulusMessage = {
    cumulus_meta: {
      asyncOperationId: t.context.asyncOperation.id,
      parentExecutionArn: t.context.parentExecutionArn,
    },
    meta: {
      collection: t.context.collection,
      provider: t.context.provider,
    },
  };
});

test.after.always(() => {
  sandbox.restore();
});

test('isPostRDSDeploymentExecution correctly returns true if Cumulus version is >= RDS deployment version', (t) => {
  const { postRDSDeploymentVersion, rdsDeploymentVersion } = t.context;
  t.true(isPostRDSDeploymentExecution({
    cumulus_meta: {
      cumulus_version: rdsDeploymentVersion,
    },
  }));
  t.true(isPostRDSDeploymentExecution({
    cumulus_meta: {
      cumulus_version: postRDSDeploymentVersion,
    },
  }));
});

test('isPostRDSDeploymentExecution correctly returns false if Cumulus version is < RDS deployment version', (t) => {
  const { preRDSDeploymentVersion } = t.context;
  t.false(isPostRDSDeploymentExecution({
    cumulus_meta: {
      cumulus_version: preRDSDeploymentVersion,
    },
  }));
});

test('isPostRDSDeploymentExecution correctly returns false if Cumulus version is missing', (t) => {
  t.false(isPostRDSDeploymentExecution({}));
});

test.serial('isPostRDSDeploymentExecution throws error if RDS_DEPLOYMENT_CUMULUS_VERSION env var is missing', (t) => {
  delete process.env.RDS_DEPLOYMENT_CUMULUS_VERSION;
  t.throws(() => isPostRDSDeploymentExecution({
    cumulus_meta: {
      cumulus_version: '2.0.0',
    },
  }));
});

test.serial('hasNoParentExecutionOrExists returns true if there is no parent execution', async (t) => {
  const { knex, doesRecordExistStub } = t.context;
  t.true(await hasNoParentExecutionOrExists({}, knex));
  t.false(doesRecordExistStub.called);
});

test.serial('hasNoParentExecutionOrExists returns true if parent execution exists', async (t) => {
  const { knex, doesRecordExistStub } = t.context;
  const parentExecutionArn = `machine:${cryptoRandomString({ length: 5 })}`;

  doesRecordExistStub.withArgs({
    arn: parentExecutionArn,
  }).resolves(true);

  t.true(await hasNoParentExecutionOrExists({
    cumulus_meta: {
      parentExecutionArn,
    },
  }, knex));
  t.true(doesRecordExistStub.called);
});

test.serial('hasNoParentExecutionOrExists returns false if parent execution does not exist', async (t) => {
  const { knex, doesRecordExistStub } = t.context;
  const parentExecutionArn = `machine:${cryptoRandomString({ length: 5 })}`;

  doesRecordExistStub.withArgs({
    arn: parentExecutionArn,
  }).resolves(false);

  t.false(await hasNoParentExecutionOrExists({
    cumulus_meta: {
      parentExecutionArn,
    },
  }, knex));
  t.true(doesRecordExistStub.called);
});

test.serial('hasNoAsyncOpOrExists returns true if there is no async operation', async (t) => {
  const { knex, doesRecordExistStub } = t.context;
  t.true(await hasNoAsyncOpOrExists({}, knex));
  t.false(doesRecordExistStub.called);
});

test.serial('hasNoAsyncOpOrExists returns true if async operation exists', async (t) => {
  const { knex, doesRecordExistStub } = t.context;
  const asyncOperationId = uuidv4();

  doesRecordExistStub.withArgs({
    id: asyncOperationId,
  }).resolves(true);

  t.true(await hasNoAsyncOpOrExists({
    cumulus_meta: {
      asyncOperationId,
    },
  }, knex));
  t.true(doesRecordExistStub.called);
});

test.serial('hasNoAsyncOpOrExists returns false if async operation does not exist', async (t) => {
  const { knex, doesRecordExistStub } = t.context;
  const asyncOperationId = uuidv4();

  doesRecordExistStub.withArgs({
    id: asyncOperationId,
  }).resolves(false);

  t.false(await hasNoAsyncOpOrExists({
    cumulus_meta: {
      asyncOperationId,
    },
  }, knex));
  t.true(doesRecordExistStub.called);
});

test('getMessageAsyncOperationCumulusId returns correct async operation cumulus_id', async (t) => {
  const { asyncOperation, cumulusMessage } = t.context;

  const fakeKnex = () => ({
    where: (params) => ({
      first: async () => {
        if (params.id === asyncOperation.id) {
          return {
            cumulus_id: 7,
          };
        }
        return undefined;
      },
    }),
  });

  t.is(
    await getMessageAsyncOperationCumulusId(cumulusMessage, fakeKnex),
    7
  );
});

test('getMessageAsyncOperationCumulusId returns undefined if there is no async operation on the message', async (t) => {
  const { knex } = t.context;
  t.is(await getMessageAsyncOperationCumulusId({}, knex), undefined);
});

test('getMessageAsyncOperationCumulusId returns undefined if async operation cannot be found', async (t) => {
  const { cumulusMessage, knex } = t.context;
  cumulusMessage.cumulus_meta.asyncOperationId = 'fake-id';
  t.is(await getMessageAsyncOperationCumulusId(cumulusMessage, knex), undefined);
});

test('getMessageParentExecutionCumulusId returns correct parent execution cumulus_id', async (t) => {
  const { cumulusMessage, parentExecutionArn } = t.context;

  const fakeKnex = () => ({
    where: (params) => ({
      first: async () => {
        if (params.arn === parentExecutionArn) {
          return {
            cumulus_id: 9,
          };
        }
        return undefined;
      },
    }),
  });

  t.is(
    await getMessageParentExecutionCumulusId(cumulusMessage, fakeKnex),
    9
  );
});

test('getMessageParentExecutionCumulusId returns undefined if there is no parent execution on the message', async (t) => {
  const { knex } = t.context;
  t.is(await getMessageParentExecutionCumulusId({}, knex), undefined);
});

test('getMessageParentExecutionCumulusId returns undefined if parent execution cannot be found', async (t) => {
  const { cumulusMessage, knex } = t.context;
  cumulusMessage.cumulus_meta.parentExecutionArn = 'fake-parent-arn';
  t.is(await getMessageParentExecutionCumulusId(cumulusMessage, knex), undefined);
});

test('getMessageCollectionCumulusId returns correct collection cumulus_id', async (t) => {
  const { collection, cumulusMessage } = t.context;

  const fakeKnex = () => ({
    where: (params) => ({
      first: async () => {
        if (params.name === collection.name
            && params.version === collection.version) {
          return {
            cumulus_id: 5,
          };
        }
        return undefined;
      },
    }),
  });

  t.is(
    await getMessageCollectionCumulusId(cumulusMessage, fakeKnex),
    5
  );
});

test('getMessageCollectionCumulusId returns undefined if there is no collection on the message', async (t) => {
  const { knex } = t.context;
  t.is(await getMessageCollectionCumulusId({}, knex), undefined);
});

test('getMessageCollectionCumulusId returns undefined if collection cannot be found', async (t) => {
  const { cumulusMessage, knex } = t.context;
  cumulusMessage.meta.collection.name = 'fake-collection-name';
  t.is(await getMessageCollectionCumulusId(cumulusMessage, knex), undefined);
});

test('getMessageProviderCumulusId returns cumulus_id of provider in message', async (t) => {
  const { cumulusMessage, provider } = t.context;

  const fakeKnex = () => ({
    where: (params) => ({
      first: async () => {
        if (params.name === provider.id) {
          return {
            cumulus_id: 234,
          };
        }
        return undefined;
      },
    }),
  });

  t.is(
    await getMessageProviderCumulusId(cumulusMessage, fakeKnex),
    234
  );
});

test('getMessageProviderCumulusId returns undefined if there is no provider in the message', async (t) => {
  const { knex } = t.context;
  t.is(await getMessageProviderCumulusId({}, knex), undefined);
});

test('getMessageProviderCumulusId returns undefined if provider cannot be found', async (t) => {
  const { cumulusMessage, knex } = t.context;
  cumulusMessage.meta.provider.id = 'bogus-provider-id';
  t.is(await getMessageProviderCumulusId(cumulusMessage, knex), undefined);
});
