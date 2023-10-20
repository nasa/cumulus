'use strict';

const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');

const awsServices = require('@cumulus/aws-client/services');
const launchpad = require('@cumulus/launchpad-auth');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { randomString } = require('@cumulus/common/test-utils');
const { CMR } = require('@cumulus/cmr-client');
const { DefaultProvider } = require('@cumulus/common/key-pair-provider');
const {
  generateLocalTestDb,
  destroyLocalTestDb,
  localStackConnectionEnv,
  CollectionPgModel,
  GranulePgModel,
  translateApiGranuleToPostgresGranule,
  fakeCollectionRecordFactory,
  migrationDir,
} = require('@cumulus/db');

const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');
const { unpublishGranule } = require('../../lib/granule-remove-from-cmr');

const testDbName = `granule_remove_cmr_${cryptoRandomString({ length: 10 })}`;

const createGranuleInPG = async (t, params) => {
  const collectionId = constructCollectionId(
    t.context.fakeCollection.name,
    t.context.fakeCollection.version
  );

  const granule = fakeGranuleFactoryV2({
    collectionId,
    ...params,
  });
  const translatedGranule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: granule,
    knexOrTransaction: t.context.knex,
  });
  const [pgGranule] = await t.context.granulePgModel.create(
    t.context.knex,
    translatedGranule
  );
  const pgGranuleCumulusId = pgGranule.cumulus_id;
  const originalPgGranule = await t.context.granulePgModel.get(
    t.context.knex,
    { cumulus_id: pgGranuleCumulusId }
  );
  return {
    originalPgGranule,
    pgGranuleCumulusId,
    collectionId,
  };
};

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.granulePgModel = new GranulePgModel();

  // Store the CMR password
  process.env.cmr_password_secret_name = randomString();
  await awsServices.secretsManager().createSecret({
    Name: process.env.cmr_password_secret_name,
    SecretString: randomString(),
  }).promise();

  // Store the launchpad passphrase
  process.env.launchpad_passphrase_secret_name = randomString();
  await awsServices.secretsManager().createSecret({
    Name: process.env.launchpad_passphrase_secret_name,
    SecretString: randomString(),
  }).promise();

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  t.context.fakeCollection = fakeCollectionRecordFactory();
  await t.context.collectionPgModel.create(t.context.knex, t.context.fakeCollection);
});

test.after.always(async (t) => {
  await awsServices.secretsManager().deleteSecret({
    SecretId: process.env.cmr_password_secret_name,
    ForceDeleteWithoutRecovery: true,
  }).promise();
  await awsServices.secretsManager().deleteSecret({
    SecretId: process.env.launchpad_passphrase_secret_name,
    ForceDeleteWithoutRecovery: true,
  }).promise();
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('unpublishGranule() removing a granule from CMR succeeds if the granule is not published to CMR', async (t) => {
  const {
    originalPgGranule,
    pgGranuleCumulusId,
  } = await createGranuleInPG(t, {
    published: false,
    cmrLink: undefined,
  });
  await unpublishGranule({ knex: t.context.knex, pgGranuleRecord: originalPgGranule });

  t.like(
    await t.context.granulePgModel.get(t.context.knex, { cumulus_id: pgGranuleCumulusId }),
    {
      published: false,
      cmr_link: null,
    }
  );
});

test.serial('unpublishGranule() removing a granule from CMR succeeds if the granule is not in CMR', async (t) => {
  const {
    originalPgGranule,
    pgGranuleCumulusId,
  } = await createGranuleInPG(t, {
    published: true,
    cmrLink: 'example.com',
  });

  const cmrMetadataStub = sinon.stub(CMR.prototype, 'getGranuleMetadata').resolves(undefined);
  t.teardown(() => {
    cmrMetadataStub.restore();
  });

  await unpublishGranule({ knex: t.context.knex, pgGranuleRecord: originalPgGranule });

  t.like(
    await t.context.granulePgModel.get(t.context.knex, { cumulus_id: pgGranuleCumulusId }),
    {
      published: false,
      cmr_link: null,
    }
  );
});

test.serial('unpublishGranule throws an error when an unexpected error is encountered', async (t) => {
  const {
    originalPgGranule,
    pgGranuleCumulusId,
  } = await createGranuleInPG(t, {
    published: false,
    cmrLink: undefined,
  });
  const unexpectedError = new Error('Unexpected CMR error');
  const cmrMetadataStub = sinon.stub(CMR.prototype, 'getGranuleMetadata').throws(unexpectedError);

  t.teardown(() => {
    cmrMetadataStub.restore();
  });

  await unpublishGranule({ knex: t.context.knex, pgGranuleRecord: originalPgGranule });
  t.like(
    await t.context.granulePgModel.get(t.context.knex, { cumulus_id: pgGranuleCumulusId }),
    {
      published: false,
      cmr_link: null,
    }
  );

  await t.throwsAsync(
    unpublishGranule({
      knex: t.context.knex,
      pgGranuleRecord: originalPgGranule,
    })
  );
  t.true(cmrMetadataStub.called);
});

test.serial('unpublishGranule does not throw an error when the granule is not published or has no cmr link', async (t) => {
  const {
    originalPgGranule,
    pgGranuleCumulusId,
  } = await createGranuleInPG(t, {
    published: false,
    cmrLink: undefined,
  });
  const granuleNotPublishedError = new Error('Granule not published Error');
  const cmrMetadataStub = sinon.stub(CMR.prototype, 'getGranuleMetadata').resolves(granuleNotPublishedError);

  t.teardown(() => {
    cmrMetadataStub.restore();
  });

  await unpublishGranule({ knex: t.context.knex, pgGranuleRecord: originalPgGranule });
  t.like(
    await t.context.granulePgModel.get(t.context.knex, { cumulus_id: pgGranuleCumulusId }),
    {
      published: false,
      cmr_link: null,
    }
  );

  await t.notThrowsAsync(
    unpublishGranule({
      knex: t.context.knex,
      pgGranuleRecord: originalPgGranule,
    })
  );
  t.true(cmrMetadataStub.called);
});

test.serial('unpublishGranule() succeeds with PG granule', async (t) => {
  const { fakeCollection } = t.context;

  const {
    originalPgGranule,
    pgGranuleCumulusId,
  } = await createGranuleInPG(t, {
    published: true,
    collectionId: constructCollectionId(fakeCollection.name, fakeCollection.version),
  });

  t.like(
    await t.context.granulePgModel.get(t.context.knex, {
      cumulus_id: pgGranuleCumulusId,
    }),
    {
      published: true,
      cmr_link: originalPgGranule.cmr_link,
    }
  );

  const cmrMetadataStub = sinon.stub(CMR.prototype, 'getGranuleMetadata').resolves({
    foo: 'bar',
  });
  const cmrDeleteStub = sinon.stub(CMR.prototype, 'deleteGranule').resolves();
  t.teardown(() => {
    cmrMetadataStub.restore();
    cmrDeleteStub.restore();
  });

  const {
    pgGranule,
  } = await unpublishGranule({ knex: t.context.knex, pgGranuleRecord: originalPgGranule });

  t.true(cmrDeleteStub.called);
  t.deepEqual(
    pgGranule,
    {
      ...pgGranule,
      published: false,
      cmr_link: null,
    }
  );
});

test.serial('unpublishGranule() accepts an optional collection', async (t) => {
  const { fakeCollection } = t.context;

  const {
    originalPgGranule,
    pgGranuleCumulusId,
  } = await createGranuleInPG(t, {
    published: true,
    collectionId: constructCollectionId(fakeCollection.name, fakeCollection.version),
  });

  t.like(
    await t.context.granulePgModel.get(t.context.knex, {
      cumulus_id: pgGranuleCumulusId,
    }),
    {
      published: true,
      cmr_link: originalPgGranule.cmr_link,
    }
  );

  const metadataTitle = 'title_string';
  const cmrMetadataStub = sinon.stub(CMR.prototype, 'getGranuleMetadata').resolves({
    title: metadataTitle,
  });
  const cmrDeleteStub = sinon.stub(CMR.prototype, 'deleteGranule').resolves();
  t.teardown(() => {
    cmrMetadataStub.restore();
    cmrDeleteStub.restore();
  });

  const {
    pgGranule,
  } = await unpublishGranule({
    knex: t.context.knex,
    pgGranuleRecord: originalPgGranule,
    pgCollection: fakeCollection,
  });

  t.is(cmrDeleteStub.calledOnceWith(
    metadataTitle
  ), true);

  t.deepEqual(
    pgGranule,
    {
      ...pgGranule,
      published: false,
      cmr_link: null,
    }
  );
});

test.serial('unpublishGranule() does not update granule CMR status or delete from CMR if PG write fails', async (t) => {
  const {
    originalPgGranule,
    pgGranuleCumulusId,
  } = await createGranuleInPG(t, {
    published: true,
  });

  t.like(
    await t.context.granulePgModel.get(t.context.knex, {
      cumulus_id: pgGranuleCumulusId,
    }),
    {
      published: true,
      cmr_link: originalPgGranule.cmr_link,
    }
  );

  const cmrMetadataStub = sinon.stub(CMR.prototype, 'getGranuleMetadata').resolves({
    foo: 'bar',
  });
  const cmrDeleteStub = sinon.stub(CMR.prototype, 'deleteGranule').resolves();
  t.teardown(() => {
    cmrMetadataStub.restore();
    cmrDeleteStub.restore();
  });

  const fakeGranulePgModel = {
    getRecordCumulusId: () => Promise.resolve(pgGranuleCumulusId),
    update: () => {
      throw new Error('PG error');
    },
  };

  await t.throwsAsync(
    unpublishGranule({
      knex: t.context.knex,
      pgGranuleRecord: originalPgGranule,
      granulePgModel: fakeGranulePgModel,
    })
  );

  t.false(cmrDeleteStub.called);
  t.like(
    await t.context.granulePgModel.get(t.context.knex, {
      cumulus_id: pgGranuleCumulusId,
    }),
    {
      published: true,
      cmr_link: originalPgGranule.cmr_link,
    }
  );
});

test.serial('unpublishGranule() does not update granule CMR status if CMR removal fails', async (t) => {
  const {
    originalPgGranule,
    pgGranuleCumulusId,
  } = await createGranuleInPG(t, {
    published: true,
  });

  const cmrMetadataStub = sinon.stub(CMR.prototype, 'getGranuleMetadata').resolves({
    title: 'bar',
  });
  const deleteError = new Error('CMR delete error');
  const cmrDeleteStub = sinon.stub(CMR.prototype, 'deleteGranule').throws(deleteError);
  t.teardown(() => {
    cmrMetadataStub.restore();
    cmrDeleteStub.restore();
  });

  t.like(
    await t.context.granulePgModel.get(t.context.knex, {
      cumulus_id: pgGranuleCumulusId,
    }),
    {
      published: true,
      cmr_link: originalPgGranule.cmr_link,
    }
  );

  await t.throwsAsync(
    unpublishGranule({
      knex: t.context.knex,
      pgGranuleRecord: originalPgGranule,
    }),
    { message: 'CMR delete error' }
  );

  t.true(cmrDeleteStub.called);
  t.like(
    await t.context.granulePgModel.get(t.context.knex, {
      cumulus_id: pgGranuleCumulusId,
    }),
    {
      published: true,
      cmr_link: originalPgGranule.cmr_link,
    }
  );
});

test.serial('removing a granule from CMR passes the granule UR to the cmr delete function', async (t) => {
  const {
    originalPgGranule,
  } = await createGranuleInPG(t, {
    published: true,
  });

  sinon.stub(
    DefaultProvider,
    'decrypt'
  ).callsFake(() => Promise.resolve('fakePassword'));

  sinon.stub(
    CMR.prototype,
    'deleteGranule'
  ).callsFake((granuleUr) => Promise.resolve(t.is(granuleUr, 'granule-ur')));

  sinon.stub(
    CMR.prototype,
    'getGranuleMetadata'
  ).callsFake(() => Promise.resolve({ title: 'granule-ur' }));

  try {
    await unpublishGranule({ knex: t.context.knex, pgGranuleRecord: originalPgGranule });
  } finally {
    CMR.prototype.deleteGranule.restore();
    DefaultProvider.decrypt.restore();
    CMR.prototype.getGranuleMetadata.restore();
  }
});

test.serial('removing a granule from CMR succeeds with Launchpad authentication', async (t) => {
  const {
    originalPgGranule,
  } = await createGranuleInPG(t, {
    published: true,
  });

  process.env.cmr_oauth_provider = 'launchpad';
  const launchpadStub = sinon.stub(launchpad, 'getLaunchpadToken').callsFake(() => randomString());

  sinon.stub(
    DefaultProvider,
    'decrypt'
  ).callsFake(() => Promise.resolve('fakePassword'));

  sinon.stub(
    CMR.prototype,
    'deleteGranule'
  ).callsFake((granuleUr) => Promise.resolve(t.is(granuleUr, 'granule-ur')));

  sinon.stub(
    CMR.prototype,
    'getGranuleMetadata'
  ).callsFake(() => Promise.resolve({ title: 'granule-ur' }));

  try {
    await unpublishGranule({ knex: t.context.knex, pgGranuleRecord: originalPgGranule });

    t.is(launchpadStub.calledOnce, true);
  } finally {
    process.env.cmr_oauth_provider = 'earthdata';
    launchpadStub.restore();
    CMR.prototype.deleteGranule.restore();
    DefaultProvider.decrypt.restore();
    CMR.prototype.getGranuleMetadata.restore();
  }
});
