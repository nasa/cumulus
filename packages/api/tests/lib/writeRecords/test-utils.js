'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const uuidv4 = require('uuid/v4');

const {
  localStackConnectionEnv,
  getKnexClient,
  migrationDir,
} = require('@cumulus/db');

const {
  isPostRDSDeploymentExecution,
  getAsyncOperationCumulusId,
  getParentExecutionCumulusId,
  getExecutionCumulusId,
  getCollectionCumulusId,
  getMessageProviderCumulusId,
  isStatusFinalState,
} = require('../../../lib/writeRecords/utils');

test.before(async (t) => {
  t.context.testDbName = `utils_${cryptoRandomString({ length: 10 })}`;

  t.context.knexAdmin = await getKnexClient({ env: localStackConnectionEnv });
  await t.context.knexAdmin.raw(`create database "${t.context.testDbName}";`);
  await t.context.knexAdmin.raw(`grant all privileges on database "${t.context.testDbName}" to "${localStackConnectionEnv.PG_USER}"`);

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: t.context.testDbName,
      migrationDir,
    },
  });
  await t.context.knex.migrate.latest();
});

test.beforeEach((t) => {
  t.context.rdsDeploymentVersion = '3.0.0';
  process.env.RDS_DEPLOYMENT_CUMULUS_VERSION = t.context.rdsDeploymentVersion;
  t.context.postRDSDeploymentVersion = '4.0.0';
  t.context.preRDSDeploymentVersion = '2.9.99';

  t.context.asyncOperation = {
    id: uuidv4(),
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

test.after.always(async (t) => {
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${t.context.testDbName}"`);
  await t.context.knexAdmin.destroy();
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

test('getAsyncOperationCumulusId returns correct async operation cumulus_id', async (t) => {
  const { asyncOperation } = t.context;

  const fakeAsyncOperationPgModel = {
    getRecordCumulusId: (_, record) => {
      if (record.id === asyncOperation.id) {
        return 7;
      }
      return undefined;
    },
  };

  t.is(
    await getAsyncOperationCumulusId(asyncOperation.id, {}, fakeAsyncOperationPgModel),
    7
  );
});

test('getAsyncOperationCumulusId returns undefined if no async operation ID is provided', async (t) => {
  const { knex } = t.context;
  t.is(await getAsyncOperationCumulusId(undefined, knex), undefined);
});

test('getAsyncOperationCumulusId returns undefined if async operation cannot be found', async (t) => {
  const { knex } = t.context;
  const asyncOperationId = uuidv4();
  t.is(await getAsyncOperationCumulusId(asyncOperationId, knex), undefined);
});

test('getParentExecutionCumulusId returns correct parent execution cumulus_id', async (t) => {
  const { parentExecutionArn } = t.context;

  const fakeExecutionPgModel = {
    getRecordCumulusId: (_, record) => {
      if (record.arn === parentExecutionArn) {
        return Promise.resolve(9);
      }
      return Promise.resolve();
    },
  };

  t.is(
    await getParentExecutionCumulusId(parentExecutionArn, {}, fakeExecutionPgModel),
    9
  );
});

test('getParentExecutionCumulusId returns undefined if no parent execution ARN is provided', async (t) => {
  const { knex } = t.context;
  t.is(await getParentExecutionCumulusId(undefined, knex), undefined);
});

test('getParentExecutionCumulusId returns undefined if parent execution cannot be found', async (t) => {
  const { knex } = t.context;
  const parentExecutionArn = 'fake-parent-arn';
  t.is(await getParentExecutionCumulusId(parentExecutionArn, knex), undefined);
});

test('getCollectionCumulusId returns correct collection cumulus_id', async (t) => {
  const { collection } = t.context;

  const fakeCollectionPgModel = {
    getRecordCumulusId: (_, record) => {
      if (record.name === collection.name
          && record.version === collection.version) {
        return 5;
      }
      return undefined;
    },
  };

  t.is(
    await getCollectionCumulusId(collection, {}, fakeCollectionPgModel),
    5
  );
});

test('getCollectionCumulusId returns undefined if no collection name/version is provided', async (t) => {
  const { knex } = t.context;
  t.is(await getCollectionCumulusId(undefined, knex), undefined);
});

test('getCollectionCumulusId returns undefined if collection cannot be found', async (t) => {
  const { collection, knex } = t.context;
  collection.name = 'fake-collection-name';
  t.is(await getCollectionCumulusId(collection, knex), undefined);
});

test('getMessageProviderCumulusId returns cumulus_id of provider in message', async (t) => {
  const { cumulusMessage, provider } = t.context;

  const fakeProviderPgModel = {
    getRecordCumulusId: (_, record) => {
      if (record.name === provider.id) {
        return Promise.resolve(234);
      }
      return Promise.resolve();
    },
  };

  t.is(
    await getMessageProviderCumulusId(cumulusMessage, {}, fakeProviderPgModel),
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

test('getExecutionCumulusId returns correct execution cumulus_id', async (t) => {
  const executionUrl = `http://${cryptoRandomString({ length: 5 })}`;
  const fakeExecutionModel = {
    getRecordCumulusId: (_, url) => {
      if (url.url === executionUrl) return Promise.resolve(987);
      return Promise.resolve(undefined);
    },
  };

  t.is(
    await getExecutionCumulusId(executionUrl, {}, fakeExecutionModel),
    987
  );
});

test('getExecutionCumulusId returns undefined if there is no executionUrl passed.', async (t) => {
  const { knex } = t.context;
  t.is(await getExecutionCumulusId(undefined, knex), undefined);
});

test('getExecutionCumulusId returns undefined if url cannot be found.', async (t) => {
  const { knex } = t.context;
  t.is(await getExecutionCumulusId('https://example.com/still/not/in/db', knex), undefined);
});

test('isStatusFinalState returns true if status only if status is "completed" or "failed"', (t) => {
  t.is(isStatusFinalState('queued'), false);
  t.is(isStatusFinalState('running'), false);
  t.is(isStatusFinalState('completed'), true);
  t.is(isStatusFinalState('failed'), true);
  t.is(isStatusFinalState('fakeStatus'), false);
});
