const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');
const orderBy = require('lodash/orderBy');

const { RecordDoesNotExist } = require('@cumulus/errors');
const { constructCollectionId, deconstructCollectionId } = require('@cumulus/message/Collections');
const {
  CollectionPgModel,
  ExecutionPgModel,
  GranulePgModel,
  GranulesExecutionsPgModel,
  ProviderPgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
  fakeProviderRecordFactory,
  upsertGranuleWithExecutionJoinRecord,
  getGranulesByGranuleId,
  getApiGranuleExecutionCumulusIds,
  getUniqueGranuleByGranuleId,
  getGranuleByUniqueColumns,
  migrationDir,
  getGranulesByApiPropertiesQuery,
  createRejectableTransaction,
} = require('../../dist');

const testDbName = `granule_lib_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granulePgModel = new GranulePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.collection = fakeCollectionRecordFactory();
  t.context.collectionId = constructCollectionId(
    t.context.collection.name,
    t.context.collection.version
  );
  const collectionResponse = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );
  t.context.collectionCumulusId = collectionResponse[0].cumulus_id;

  t.context.executionPgModel = new ExecutionPgModel();
  t.context.providerPgModel = new ProviderPgModel();
});

test.beforeEach(async (t) => {
  const [pgExecution] = await t.context.executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory()
  );
  t.context.executionCumulusId = pgExecution.cumulus_id;

  const [pgCompletedExecution] = await t.context.executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'completed' })
  );
  t.context.completedExecutionCumulusId = pgCompletedExecution.cumulus_id;
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('upsertGranuleWithExecutionJoinRecord() creates granule record with granule/execution join record', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
    granulesExecutionsPgModel,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  const [pgGranule] = await createRejectableTransaction(
    knex,
    (trx) => upsertGranuleWithExecutionJoinRecord({
      executionCumulusId,
      granule,
      knexTransaction: trx,
    })
  );
  const granuleCumulusId = pgGranule.cumulus_id;

  const granuleRecord = await granulePgModel.get(
    knex,
    granule
  );

  t.like(
    granuleRecord,
    {
      ...granule,
      cumulus_id: granuleCumulusId,
    }
  );
  t.deepEqual(
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [{
      granule_cumulus_id: granuleCumulusId,
      execution_cumulus_id: executionCumulusId,
    }]
  );
});

test('upsertGranuleWithExecutionJoinRecord() handles multiple executions for a granule', async (t) => {
  const {
    knex,
    granulePgModel,
    executionPgModel,
    granulesExecutionsPgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  const [pgGranule] = await createRejectableTransaction(
    knex,
    (trx) => upsertGranuleWithExecutionJoinRecord({
      executionCumulusId,
      granule,
      knexTransaction: trx,
    })
  );
  const granuleCumulusId = pgGranule.cumulus_id;

  const [secondExecutionCumulus] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );
  const secondExecutionCumulusId = secondExecutionCumulus.cumulus_id;

  await createRejectableTransaction(
    knex,
    (trx) => upsertGranuleWithExecutionJoinRecord({
      executionCumulusId: secondExecutionCumulusId,
      granule,
      knexTransaction: trx,
    })
  );

  const granuleRecord = await granulePgModel.get(
    knex,
    granule
  );

  t.like(
    granuleRecord,
    {
      ...granule,
      cumulus_id: granuleCumulusId,
    }
  );
  t.deepEqual(
    orderBy(await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ), 'execution_cumulus_id'),
    orderBy([executionCumulusId, secondExecutionCumulusId].map((executionId) => ({
      granule_cumulus_id: granuleCumulusId,
      execution_cumulus_id: executionId,
    })), 'execution_cumulus_id')
  );
});

test('upsertGranuleWithExecutionJoinRecord() does not write anything if upserting granule/execution join record fails', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
    granulesExecutionsPgModel,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  const fakeGranulesExecutionsPgModel = {
    upsert: () => Promise.reject(new Error('error')),
  };

  await t.throwsAsync(
    createRejectableTransaction(
      knex,
      (trx) =>
        upsertGranuleWithExecutionJoinRecord({
          executionCumulusId,
          granule,
          granulesExecutionsPgModel: fakeGranulesExecutionsPgModel,
          knexTransaction: trx,
        })
    )
  );

  t.false(
    await granulePgModel.exists(
      knex,
      {
        granule_id: granule.granule_id,
        collection_cumulus_id: collectionCumulusId,
      }
    )
  );
  t.false(
    await granulesExecutionsPgModel.exists(
      knex,
      {
        execution_cumulus_id: executionCumulusId,
      }
    )
  );
});

test('upsertGranuleWithExecutionJoinRecord() will allow a running status to replace a non-running status for different execution', async (t) => {
  const {
    knex,
    granulePgModel,
    executionPgModel,
    granulesExecutionsPgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  const [pgGranule] = await upsertGranuleWithExecutionJoinRecord({
    executionCumulusId,
    granule,
    knexTransaction: knex,
  });
  const granuleCumulusId = pgGranule.cumulus_id;

  const [secondExecution] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );
  const secondExecutionCumulusId = secondExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule: updatedGranule,
    executionCumulusId: secondExecutionCumulusId,
  });

  const granuleRecord = await granulePgModel.get(
    knex,
    updatedGranule
  );

  t.like(
    granuleRecord,
    {
      ...updatedGranule,
      cumulus_id: granuleCumulusId,
    }
  );
  t.deepEqual(
    orderBy(await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ), 'execution_cumulus_id'),
    orderBy([executionCumulusId, secondExecutionCumulusId].map((executionId) => ({
      granule_cumulus_id: granuleCumulusId,
      execution_cumulus_id: executionId,
    })), 'execution_cumulus_id')
  );
});

test('upsertGranuleWithExecutionJoinRecord() succeeds if granulePgModel.upsert() affects no rows', async (t) => {
  const {
    knex,
    granulePgModel,
    granulesExecutionsPgModel,
    collectionCumulusId,
    completedExecutionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  const [pgGranule] = await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId: completedExecutionCumulusId,
  });
  const granuleCumulusId = pgGranule.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await upsertGranuleWithExecutionJoinRecord({
    executionCumulusId: completedExecutionCumulusId,
    granule: updatedGranule,
    knexTransaction: knex,
  });

  const granuleRecord = await granulePgModel.get(
    knex,
    granule
  );

  t.like(
    granuleRecord,
    {
      ...granule,
      cumulus_id: granuleCumulusId,
    }
  );
  t.deepEqual(
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [{
      granule_cumulus_id: granuleCumulusId,
      execution_cumulus_id: completedExecutionCumulusId,
    }]
  );
});

test('getApiGranuleExecutionCumulusIds() returns correct values', async (t) => {
  const {
    knex,
    collection,
    collectionCumulusId,
    collectionPgModel,
    executionCumulusId,
    executionPgModel,
    granulePgModel,
    granulesExecutionsPgModel,
  } = t.context;

  const collectionId = constructCollectionId(collection.name, collection.version);

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  await createRejectableTransaction(
    knex,
    (trx) => upsertGranuleWithExecutionJoinRecord({
      executionCumulusId,
      granule,
      knexTransaction: trx,
    })
  );

  const [secondExecution] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );
  const secondExecutionCumulusId = secondExecution.cumulus_id;

  await createRejectableTransaction(
    knex,
    (trx) => upsertGranuleWithExecutionJoinRecord({
      executionCumulusId: secondExecutionCumulusId,
      granule,
      knexTransaction: trx,
    })
  );

  const granules = [
    {
      granuleId: granule.granule_id,
      collectionId,
    },
  ];

  const results = await getApiGranuleExecutionCumulusIds(
    knex,
    granules,
    collectionPgModel,
    granulePgModel,
    granulesExecutionsPgModel
  );

  t.deepEqual(results.sort(), [executionCumulusId, secondExecutionCumulusId].sort());
});

test('getApiGranuleExecutionCumulusIds() only queries DB when collection is not in map', async (t) => {
  const {
    knex,
    collection,
    collectionCumulusId,
    collectionPgModel,
    executionCumulusId,
    executionPgModel,
    granulePgModel,
    granulesExecutionsPgModel,
  } = t.context;

  const getCollectionRecordCumulusIdSpy = sinon.spy(CollectionPgModel.prototype, 'getRecordCumulusId');

  t.teardown(() => {
    getCollectionRecordCumulusIdSpy.restore();
  });

  const collectionId = constructCollectionId(collection.name, collection.version);

  const granule1 = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  const granule2 = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  await createRejectableTransaction(knex, (trx) =>
    upsertGranuleWithExecutionJoinRecord({
      granule: granule1,
      knexTransaction: trx,
      executionCumulusId,
    }));

  const [secondExecution] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );
  const secondExecutionCumulusId = secondExecution.cumulus_id;

  await createRejectableTransaction(
    knex,
    (trx) => upsertGranuleWithExecutionJoinRecord({
      knexTransaction: trx,
      granule: granule1,
      executionCumulusId: secondExecutionCumulusId,
    })
  );

  await createRejectableTransaction(
    knex,
    (trx) => upsertGranuleWithExecutionJoinRecord({
      knexTransaction: trx,
      granule: granule2,
      executionCumulusId: secondExecutionCumulusId,
    })
  );

  const granules = [
    {
      granuleId: granule1.granule_id,
      collectionId,
    },
    {
      granuleId: granule2.granule_id,
      collectionId,
    },
  ];

  const { name, version } = deconstructCollectionId(collectionId);
  // we should only query collection once since the two granules have the same collection
  t.true(getCollectionRecordCumulusIdSpy.calledOnceWith(knex, { name, version }));

  const results = await getApiGranuleExecutionCumulusIds(
    knex,
    granules,
    collectionPgModel,
    granulePgModel,
    granulesExecutionsPgModel
  );

  t.deepEqual(results.sort(), [executionCumulusId, secondExecutionCumulusId].sort());
});

test.serial('getGranulesByApiPropertiesQuery returns correct granules by single collection ID', async (t) => {
  const {
    collection,
    collectionId,
    collectionCumulusId,
    knex,
    granulePgModel,
  } = t.context;
  const [granule] = await granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
    }),
    '*'
  );
  t.teardown(() => granulePgModel.delete(knex, { cumulus_id: granule.cumulus_id }));

  const record = await getGranulesByApiPropertiesQuery({
    knex,
    searchParams: {
      collectionIds: collectionId,
    },
  });
  t.deepEqual(
    [{
      ...granule,
      providerName: null,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }],
    record
  );
});

test.serial('getGranulesByApiPropertiesQuery returns correct granules by multiple collection IDs', async (t) => {
  const {
    collection,
    collectionId,
    collectionCumulusId,
    knex,
    granulePgModel,
  } = t.context;

  const collection2 = fakeCollectionRecordFactory();
  const collectionId2 = constructCollectionId(
    collection2.name,
    collection2.version
  );
  const pgCollection2 = await t.context.collectionPgModel.create(
    knex,
    collection2
  );
  const collectionCumulusId2 = pgCollection2[0].cumulus_id;

  const granule1 = fakeGranuleRecordFactory({
    granule_id: `1_${cryptoRandomString({ length: 5 })}`,
    collection_cumulus_id: collectionCumulusId,
  });
  const granule2 = fakeGranuleRecordFactory({
    granule_id: `2_${cryptoRandomString({ length: 5 })}`,
    collection_cumulus_id: collectionCumulusId2,
  });
  const granules = orderBy(
    await granulePgModel.insert(
      knex,
      [granule1, granule2],
      '*'
    ),
    'granule_id'
  );
  t.teardown(() => Promise.all(granules.map(
    (granule) =>
      granulePgModel.delete(knex, { cumulus_id: granule.cumulus_id })
  )));

  const records = await getGranulesByApiPropertiesQuery({
    knex,
    searchParams: {
      collectionIds: [collectionId, collectionId2],
    },
    sortByFields: ['granule_id'],
  });
  t.deepEqual(
    [{
      ...granules.find((granule) => granule.granule_id === granule1.granule_id),
      providerName: null,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }, {
      ...granules.find((granule) => granule.granule_id === granule2.granule_id),
      providerName: null,
      collectionName: collection2.name,
      collectionVersion: collection2.version,
    }],
    records
  );
});

test.serial('getGranulesByApiPropertiesQuery returns correct granules by single granule ID', async (t) => {
  const {
    collection,
    collectionCumulusId,
    knex,
    granulePgModel,
  } = t.context;

  const [granule] = await granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
    }),
    '*'
  );

  t.teardown(() => granulePgModel.delete(knex, { cumulus_id: granule.cumulus_id }));

  const records = await getGranulesByApiPropertiesQuery({
    knex,
    searchParams: {
      granuleIds: [granule.granule_id],
    },
  });
  t.deepEqual(
    [{
      ...granule,
      providerName: null,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }],
    records
  );
});

test.serial('getGranulesByApiPropertiesQuery returns correct granules by multiple granule IDs', async (t) => {
  const {
    collection,
    collectionCumulusId,
    knex,
    granulePgModel,
  } = t.context;

  const granules = orderBy(
    await granulePgModel.insert(
      knex,
      [
        fakeGranuleRecordFactory({
          collection_cumulus_id: collectionCumulusId,
        }),
        fakeGranuleRecordFactory({
          collection_cumulus_id: collectionCumulusId,
        }),
      ],
      '*'
    ),
    'granule_id'
  );

  t.teardown(() => Promise.all(granules.map(
    (granule) =>
      granulePgModel.delete(knex, { cumulus_id: granule.cumulus_id })
  )));

  const records = await getGranulesByApiPropertiesQuery({
    knex,
    searchParams: {
      granuleIds: [granules[0].granule_id, granules[1].granule_id],
    },
  });
  t.deepEqual(
    [{
      ...granules[0],
      providerName: null,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }, {
      ...granules[1],
      providerName: null,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }],
    orderBy(records, 'granule_id')
  );
});

test.serial('getGranulesByApiPropertiesQuery returns correct granules by providers', async (t) => {
  const {
    collectionCumulusId,
    knex,
    granulePgModel,
    providerPgModel,
    collection,
  } = t.context;

  const fakeProvider = fakeProviderRecordFactory();
  const [pgProvider] = await providerPgModel.create(knex, fakeProvider);

  const [granule] = await granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      provider_cumulus_id: pgProvider.cumulus_id,
    }),
    '*'
  );
  t.teardown(() => granulePgModel.delete(knex, { cumulus_id: granule.cumulus_id }));
  const records = await getGranulesByApiPropertiesQuery({
    knex,
    searchParams: {
      providerNames: [fakeProvider.name],
    },
  });
  t.deepEqual(
    [{
      ...granule,
      providerName: fakeProvider.name,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }],
    records
  );
});

test.serial('getGranulesByApiPropertiesQuery returns results POSIX/ASCII sorted when collition is set to "C"', async (t) => {
  const {
    collectionCumulusId,
    knex,
    granulePgModel,
    providerPgModel,
  } = t.context;

  const fakeProvider = fakeProviderRecordFactory();
  const [provider] = await providerPgModel.create(knex, fakeProvider);

  const granules = await granulePgModel.insert(
    knex,
    [
      fakeGranuleRecordFactory({
        collection_cumulus_id: collectionCumulusId,
        provider_cumulus_id: provider.cumulus_id,
        status: 'completed',
        granule_id: 'MYDGRANULE',
      }),
      fakeGranuleRecordFactory({
        collection_cumulus_id: collectionCumulusId,
        provider_cumulus_id: provider.cumulus_id,
        status: 'completed',
        granule_id: 'lowerCaseGranuleShouldGoLast',
      }),
    ],
    '*'
  );
  t.teardown(() => Promise.all(granules.map(
    (granule) =>
      granulePgModel.delete(knex, { cumulus_id: granule.cumulus_id })
  )));
  const query = getGranulesByApiPropertiesQuery({
    knex,
    searchParams: {
      collate: 'C',
      status: 'completed',
    },
    sortByFields: ['granule_id'],
  });
  const records = await query;
  t.is(records.length, 2);
  t.is(records[0].granule_id, 'MYDGRANULE');
  t.is(records[1].granule_id, 'lowerCaseGranuleShouldGoLast');
});

test.serial('getGranulesByApiPropertiesQuery returns correct granules by status', async (t) => {
  const {
    collectionCumulusId,
    knex,
    granulePgModel,
    providerPgModel,
    collection,
  } = t.context;

  const fakeProvider = fakeProviderRecordFactory();
  const [provider] = await providerPgModel.create(knex, fakeProvider);

  const granules = await granulePgModel.insert(
    knex,
    [
      fakeGranuleRecordFactory({
        collection_cumulus_id: collectionCumulusId,
        provider_cumulus_id: provider.cumulus_id,
        status: 'running',
      }),
      fakeGranuleRecordFactory({
        collection_cumulus_id: collectionCumulusId,
        provider_cumulus_id: provider.cumulus_id,
        status: 'completed',
      }),
    ],
    '*'
  );
  t.teardown(() => Promise.all(granules.map(
    (granule) =>
      granulePgModel.delete(knex, { cumulus_id: granule.cumulus_id })
  )));
  const records = await getGranulesByApiPropertiesQuery({
    knex,
    searchParams: {
      status: 'completed',
    },
  });
  t.is(records.length, 1);
  t.deepEqual(
    [{
      ...granules.find((granule) => granule.status === 'completed'),
      providerName: fakeProvider.name,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }],
    records
  );
});

test.serial('getGranulesByApiPropertiesQuery returns correct granules by updated_at from date', async (t) => {
  const {
    collectionCumulusId,
    knex,
    granulePgModel,
    collection,
  } = t.context;

  const now = Date.now();
  const updatedAt = new Date(now);

  const [granule] = await granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      updated_at: updatedAt,
    }),
    '*'
  );
  t.teardown(() => granulePgModel.delete(knex, { cumulus_id: granule.cumulus_id }));

  const records = await getGranulesByApiPropertiesQuery({
    knex,
    searchParams: {
      updatedAtRange: {
        updatedAtFrom: updatedAt,
      },
    },
  });
  t.deepEqual(
    [{
      ...granule,
      providerName: null,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }],
    records
  );

  const records2 = await getGranulesByApiPropertiesQuery({
    knex,
    searchParams: {
      updatedAtRange: {
        updatedAtFrom: new Date(now - 1),
      },
    },
  });
  t.deepEqual(
    [{
      ...granule,
      providerName: null,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }],
    records2
  );
});

test.serial('getGranulesByApiPropertiesQuery returns correct granules by updated_at to date', async (t) => {
  const {
    collection,
    collectionCumulusId,
    knex,
    granulePgModel,
  } = t.context;

  const now = Date.now();
  const updatedAt = new Date(now);

  const [granule] = await granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      updated_at: updatedAt,
    }),
    '*'
  );
  t.teardown(() => granulePgModel.delete(knex, { cumulus_id: granule.cumulus_id }));

  const records = await getGranulesByApiPropertiesQuery({
    knex,
    searchParams: {
      updatedAtRange: {
        updatedAtTo: updatedAt,
      },
    },
  });
  t.deepEqual(
    [{
      ...granule,
      providerName: null,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }],
    records
  );

  const records2 = await getGranulesByApiPropertiesQuery({
    knex,
    searchParams: {
      updatedAtRange: {
        updatedAtTo: new Date(now + 1),
      },
    },
  });
  t.deepEqual(
    [{
      ...granule,
      providerName: null,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }],
    records2
  );
});

test.serial('getGranulesByApiPropertiesQuery returns correct granules by updated_at date range', async (t) => {
  const {
    collection,
    collectionCumulusId,
    granulePgModel,
    knex,
  } = t.context;

  const now = Date.now();
  const updatedAt = new Date(now);

  const [granule] = await granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      updated_at: updatedAt,
    }),
    '*'
  );
  t.teardown(() => granulePgModel.delete(knex, { cumulus_id: granule.cumulus_id }));

  const records = await getGranulesByApiPropertiesQuery({
    knex,
    searchParams: {
      updatedAtRange: {
        updatedAtFrom: updatedAt,
        updatedAtTo: updatedAt,
      },
    },
  });
  t.deepEqual(
    [{
      ...granule,
      providerName: null,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }],
    records
  );

  const records2 = await getGranulesByApiPropertiesQuery({
    knex,
    searchParams: {
      updatedAtRange: {
        updatedAtFrom: new Date(now - 1),
        updatedAtTo: new Date(now + 1),
      },
    },
  });
  t.deepEqual(
    [{
      ...granule,
      providerName: null,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }],
    records2
  );
});

test('getUniqueGranuleByGranuleId() returns a single granule', async (t) => {
  const {
    knex,
    collectionCumulusId,
    granulePgModel,
  } = t.context;

  const fakeGranule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  const [createdPgGranule] = await granulePgModel.create(knex, fakeGranule);

  const pgGranule = await granulePgModel.get(knex, { cumulus_id: createdPgGranule.cumulus_id });

  t.deepEqual(
    await getUniqueGranuleByGranuleId(knex, pgGranule.granule_id, granulePgModel),
    pgGranule
  );
});

test('getGranuleByUniqueColumns() returns a single granule', async (t) => {
  const {
    knex,
    collectionCumulusId,
    granulePgModel,
    collectionPgModel,
  } = t.context;

  // Create the granule
  const fakeGranule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  const [createdPgGranule] = await granulePgModel.create(knex, fakeGranule);
  const pgGranule = await granulePgModel.get(knex, { cumulus_id: createdPgGranule.cumulus_id });

  // Create a new collection
  const fakeCollection = fakeCollectionRecordFactory();
  const [createdPgCollection] = await collectionPgModel.create(knex, fakeCollection);

  // Create a second granule with the same granule ID but the new collection Cumulus ID
  // to ensure that the granule we fetch is the correct one
  const fakeGranule2 = fakeGranuleRecordFactory({
    granule_id: createdPgGranule.granule_id,
    collection_cumulus_id: createdPgCollection.cumulus_id,
  });
  await granulePgModel.create(knex, fakeGranule2);

  t.deepEqual(
    await getGranuleByUniqueColumns(
      knex,
      pgGranule.granule_id,
      collectionCumulusId,
      granulePgModel
    ),
    pgGranule
  );
});

test('getUniqueGranuleByGranuleId() throws an error if more than one granule is found', async (t) => {
  const {
    knex,
    collectionCumulusId,
    collectionPgModel,
    granulePgModel,
  } = t.context;

  const granuleId = 1;

  const collection = fakeCollectionRecordFactory({ name: 'collectionName2', version: 'collectionVersion2' });
  const [collectionPgRecord] = await collectionPgModel.create(knex, collection);
  const collectionCumulusId2 = collectionPgRecord.cumulus_id;

  // 2 records. Same granule ID, different collections
  const fakeGranules = [
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      granule_id: granuleId,
    }),
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId2,
      granule_id: granuleId,
    }),
  ];

  const granules = await Promise.all(fakeGranules.map((fakeGranule) =>
    granulePgModel.create(knex, fakeGranule)));
  const granuleIds = granules.map(([granule]) => granule.cumulus_id);

  const pgGranule = await granulePgModel.get(knex, { cumulus_id: granuleIds[0] });

  await t.throwsAsync(
    getUniqueGranuleByGranuleId(knex, pgGranule.granule_id, granulePgModel),
    { instanceOf: Error }
  );
});

test('getUniqueGranuleByGranuleId() throws an error if no granules are found', async (t) => {
  const {
    knex,
    granulePgModel,
  } = t.context;

  await t.throwsAsync(
    getUniqueGranuleByGranuleId(knex, 99999, granulePgModel),
    { instanceOf: RecordDoesNotExist }
  );
});

test('getGranulesByGranuleId() returns a list of records that match the given granuleId', async (t) => {
  const {
    collectionCumulusId,
    knex,
    granulePgModel,
  } = t.context;
  const granuleId = 'granule-1234';
  const [granule1] = await granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }),
    '*'
  );
  const collection2 = fakeCollectionRecordFactory();
  const collectionResponse = await t.context.collectionPgModel.create(
    knex,
    collection2
  );
  const collectionCumulusId2 = collectionResponse[0].cumulus_id;
  const [granule2] = await granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId2,
    }),
    '*'
  );
  const records = await getGranulesByGranuleId(knex, granuleId);
  t.deepEqual(records, [granule1, granule2]);
  t.teardown(async () => await Promise.all([
    granulePgModel.delete(knex, { cumulus_id: granule1.cumulus_id }),
    granulePgModel.delete(knex, { cumulus_id: granule2.cumulus_id }),
  ]));
});

test('getGranulesByGranuleId() returns empty list when called with a granuleId that does not exist', async (t) => {
  const {
    collectionCumulusId,
    knex,
    granulePgModel,
  } = t.context;
  const granuleId = 'fakeGranuleId';
  await granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
    }),
    '*'
  );
  const records = await getGranulesByGranuleId(knex, granuleId);
  t.deepEqual(records, []);
});
