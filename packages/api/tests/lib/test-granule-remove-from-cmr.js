'use strict';

const test = require('ava');
const sinon = require('sinon');
const omit = require('lodash/omit');
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
} = require('@cumulus/db');

const Granule = require('../../models/granules');
const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');
const { unpublishGranule } = require('../../lib/granule-remove-from-cmr');
const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `granule_remove_cmr_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  process.env.GranulesTable = randomString();
  t.context.granulesModel = new Granule();
  await t.context.granulesModel.createTable();

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
  await t.context.granulesModel.deleteTable();
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('unpublishGranule() removing a granule from CMR fails if the granule is not in CMR', async (t) => {
  const granule = fakeGranuleFactoryV2({ published: false });

  await t.context.granulesModel.create(granule);

  try {
    await unpublishGranule(t.context.knex, granule);
  } catch (error) {
    t.is(error.message, `Granule ${granule.granuleId} is not published to CMR, so cannot be removed from CMR`);
  }
});

test.serial('unpublishGranule() succeeds with Dynamo granule only', async (t) => {
  const granule = fakeGranuleFactoryV2({ published: true });

  await t.context.granulesModel.create(granule);

  const cmrMetadataStub = sinon.stub(CMR.prototype, 'getGranuleMetadata').resolves({
    foo: 'bar',
  });
  const cmrDeleteStub = sinon.stub(CMR.prototype, 'deleteGranule').resolves();
  t.teardown(() => {
    cmrMetadataStub.restore();
    cmrDeleteStub.restore();
  });

  const { dynamoGranule, pgGranule } = await unpublishGranule(t.context.knex, granule);

  const expectedDynamoGranule = {
    ...granule,
    published: false,
    updatedAt: dynamoGranule.updatedAt,
  };
  delete expectedDynamoGranule.cmrLink;

  t.deepEqual(
    dynamoGranule,
    expectedDynamoGranule
  );
  t.falsy(pgGranule);
});

test.serial('unpublishGranule() succeeds with Dynamo and PG granule', async (t) => {
  const fakeCollection = fakeCollectionRecordFactory();

  const granule = fakeGranuleFactoryV2({
    published: true,
    collectionId: constructCollectionId(fakeCollection.name, fakeCollection.version),
  });
  await t.context.granulesModel.create(granule);

  t.like(
    await t.context.granulesModel.get({ granuleId: granule.granuleId }),
    {
      published: true,
      cmrLink: granule.cmrLink,
    }
  );

  await t.context.collectionPgModel.create(t.context.knex, fakeCollection);
  const originalPgGranule = await translateApiGranuleToPostgresGranule(
    granule,
    t.context.knex
  );
  const [pgGranuleCumulusId] = await t.context.granulePgModel.create(
    t.context.knex,
    originalPgGranule
  );

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

  const { dynamoGranule, pgGranule } = await unpublishGranule(t.context.knex, granule);

  t.deepEqual(
    dynamoGranule,
    omit(
      {
        ...granule,
        published: false,
        updatedAt: dynamoGranule.updatedAt,
      },
      'cmrLink'
    )
  );
  t.deepEqual(
    pgGranule,
    {
      ...pgGranule,
      published: false,
      cmr_link: null,
    }
  );
});

test.serial('unpublishGranule() does not update granule if PG write fails', async (t) => {
  const fakeCollection = fakeCollectionRecordFactory();

  const granule = fakeGranuleFactoryV2({
    published: true,
    collectionId: constructCollectionId(fakeCollection.name, fakeCollection.version),
  });
  await t.context.granulesModel.create(granule);

  t.like(
    await t.context.granulesModel.get({ granuleId: granule.granuleId }),
    {
      published: true,
      cmrLink: granule.cmrLink,
    }
  );

  await t.context.collectionPgModel.create(t.context.knex, fakeCollection);
  const originalPgGranule = await translateApiGranuleToPostgresGranule(
    granule,
    t.context.knex
  );
  const [pgGranuleCumulusId] = await t.context.granulePgModel.create(
    t.context.knex,
    originalPgGranule
  );

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
    unpublishGranule(
      t.context.knex,
      granule,
      fakeGranulePgModel
    )
  );

  t.like(
    await t.context.granulesModel.get({ granuleId: granule.granuleId }),
    {
      published: true,
      cmrLink: granule.cmrLink,
    }
  );
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

test.serial('unpublishGranule() does not update granule if Dynamo write fails', async (t) => {
  const fakeCollection = fakeCollectionRecordFactory();

  const granule = fakeGranuleFactoryV2({
    published: true,
    collectionId: constructCollectionId(fakeCollection.name, fakeCollection.version),
  });
  await t.context.granulesModel.create(granule);

  t.like(
    await t.context.granulesModel.get({ granuleId: granule.granuleId }),
    {
      published: true,
      cmrLink: granule.cmrLink,
    }
  );

  await t.context.collectionPgModel.create(t.context.knex, fakeCollection);
  const originalPgGranule = await translateApiGranuleToPostgresGranule(
    granule,
    t.context.knex
  );
  const [pgGranuleCumulusId] = await t.context.granulePgModel.create(
    t.context.knex,
    originalPgGranule
  );

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

  const fakeGranuleDynamoModel = {
    update: () => {
      throw new Error('Dynamo error');
    },
  };

  await t.throwsAsync(
    unpublishGranule(
      t.context.knex,
      granule,
      t.context.granulePgModel,
      fakeGranuleDynamoModel
    )
  );

  t.like(
    await t.context.granulesModel.get({ granuleId: granule.granuleId }),
    {
      published: true,
      cmrLink: granule.cmrLink,
    }
  );
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
    const granule = fakeGranuleFactoryV2();

    await t.context.granulesModel.create(granule);

    await unpublishGranule(t.context.knex, granule);
  } finally {
    CMR.prototype.deleteGranule.restore();
    DefaultProvider.decrypt.restore();
    CMR.prototype.getGranuleMetadata.restore();
  }
});

test.serial('removing a granule from CMR succeeds with Launchpad authentication', async (t) => {
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
    const granule = fakeGranuleFactoryV2();

    await t.context.granulesModel.create(granule);

    await unpublishGranule(t.context.knex, granule);

    t.is(launchpadStub.calledOnce, true);
  } finally {
    process.env.cmr_oauth_provider = 'earthdata';
    launchpadStub.restore();
    CMR.prototype.deleteGranule.restore();
    DefaultProvider.decrypt.restore();
    CMR.prototype.getGranuleMetadata.restore();
  }
});
