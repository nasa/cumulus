'use strict';

const test = require('ava');
const rewire = require('rewire');
const sinon = require('sinon');
const sortBy = require('lodash/sortBy');
const cryptoRandomString = require('crypto-random-string');
// TODO abstract this setup

const { randomId } = require('@cumulus/common/test-utils');
const { deconstructCollectionId } = require('@cumulus/message/Collections');
const {
  fakeProviderRecordFactory,
  CollectionPgModel,
  GranulePgModel,
  FilePgModel,
  GranulesExecutionsPgModel,
  ProviderPgModel,
  migrationDir,
  destroyLocalTestDb,
  generateLocalTestDb,
  translateApiGranuleToPostgresGranule,
  translateApiCollectionToPostgresCollection,
  localStackConnectionEnv,
  translateApiFiletoPostgresFile,
} = require('@cumulus/db');

const {
  fakeCollectionFactory,
  fakeGranuleFactoryV2,
  fakeOrcaGranuleFactory,
} = require('../../lib/testUtils');
const {
  fileConflictTypes,
  orcaReconciliationReportForGranules,
} = require('../../lambdas/reports/orca-backup-reconciliation-report');
const OBRP = rewire('../../lambdas/reports/orca-backup-reconciliation-report');
const ORCASearchCatalogQueue = require('../../lib/ORCASearchCatalogQueue');
const shouldFileBeExcludedFromOrca = OBRP.__get__('shouldFileBeExcludedFromOrca');
const getReportForOneGranule = OBRP.__get__('getReportForOneGranule');

function translateTestGranuleObject(apiGranule) {
  const { name: collectionName, version: collectionVersion } =
    deconstructCollectionId(apiGranule.collectionId);
  return {
    ...apiGranule,
    collectionName,
    collectionVersion,
  };
}

function fakeCollectionsAndGranules() {
  const fakeCollectionV1 = fakeCollectionFactory({
    name: 'fakeCollection',
    version: 'v1',
    meta: {
      orca: {
        excludedFileExtensions: ['.xml', '.met'],
      },
    },
  });
  const fakeCollectionV2 = fakeCollectionFactory({
    name: 'fakeCollection',
    version: 'v2',
  });

  // granule is in both cumulus and orca, and conform to configuration
  const matchingCumulusGran = {
    ...fakeGranuleFactoryV2(),
    granuleId: randomId('matchingGranId'),
    collectionId: 'fakeCollection___v2',
    provider: 'fakeProvider2',
    files: [
      {
        bucket: 'cumulus-protected-bucket2',
        fileName: 'fakeFileName2.hdf',
        key: 'fakePath2/fakeFileName2.hdf',
      },
    ],
  };

  const matchingOrcaGran = {
    ...fakeOrcaGranuleFactory(),
    providerId: matchingCumulusGran.provider,
    collectionId: matchingCumulusGran.collectionId,
    id: matchingCumulusGran.granuleId,
    files: [
      {
        name: 'fakeFileName2.hdf',
        cumulusArchiveLocation: 'cumulus-protected-bucket2',
        orcaArchiveLocation: 'orca-bucket2',
        keyPath: 'fakePath2/fakeFileName2.hdf',
      },
    ],
  };

  // granule is in cumulus only, should not be in orca, and conform to configuration
  const matchingCumulusOnlyGran = {
    ...fakeGranuleFactoryV2(),
    granuleId: randomId('matchingCumulusOnlyGranId'),
    collectionId: 'fakeCollection___v1',
    files: [
      {
        bucket: 'cumulus-protected-bucket',
        fileName: 'fakeFileName.xml',
        key: 'fakePath/fakeFileName4.xml',
      },
      {
        bucket: 'cumulus-protected-bucket',
        fileName: 'fakeFileName.hdf.met',
        key: 'fakePath/fakeFileName4.hdf.met',
      },
    ],
  };

  // cumulus granule and its orca granule with file conflicts
  const conflictCumulusGran = {
    ...fakeGranuleFactoryV2(),
    granuleId: randomId('conflictGranuleId'),
    collectionId: 'fakeCollection___v1',
    provider: 'fakeProvider',
    files: [
      {
        bucket: 'cumulus-protected-bucket',
        fileName: 'fakeFileName.hdf',
        key: 'fakePath/fakeFileName3.hdf',
      },
      {
        bucket: 'cumulus-private-bucket',
        fileName: 'fakeFileName.hdf.met',
        key: 'fakePath/fakeFileName3.hdf.met',
      },
      {
        bucket: 'cumulus-fake-bucket',
        fileName: 'fakeFileName_onlyInCumulus.jpg',
        key: 'fakePath/fakeFileName3_onlyInCumulus.jpg',
      },
      {
        bucket: 'cumulus-fake-bucket-2',
        fileName: 'fakeFileName.cmr.xml',
        key: 'fakePath/fakeFileName3.cmr.xml',
      },
    ],
  };
  const conflictOrcaGran = {
    ...fakeOrcaGranuleFactory(),
    providerId: conflictCumulusGran.provider,
    collectionId: conflictCumulusGran.collectionId,
    id: conflictCumulusGran.granuleId,
    files: [
      {
        name: 'fakeFileName.hdf',
        cumulusArchiveLocation: 'cumulus-protected-bucket',
        orcaArchiveLocation: 'orca-bucket',
        keyPath: 'fakePath/fakeFileName3.hdf',
      },
      {
        name: 'fakeFileName_onlyInOrca.jpg',
        cumulusArchiveLocation: 'cumulus-fake-bucket',
        orcaArchiveLocation: 'orca-bucket',
        keyPath: 'fakePath/fakeFileName3_onlyInOrca.jpg',
      },
      {
        name: 'fakeFileName.cmr.xml',
        cumulusArchiveLocation: 'cumulus-fake-bucket-2',
        orcaArchiveLocation: 'orca-bucket',
        keyPath: 'fakePath/fakeFileName3.cmr.xml',
      },
    ],
  };

  // granule is only in cumulus, and has no file, should be reported as ok
  const cumulusOnlyGranNoFile = fakeGranuleFactoryV2();

  // granule is only in orca
  const orcaOnlyGranule = fakeOrcaGranuleFactory();

  // granule is only in cumulus and should be in orca as well
  const conflictCumulusOnlyGran = {
    ...fakeGranuleFactoryV2(),
    granuleId: randomId('conflictCumulusOnlyGranId'),
    collectionId: 'fakeCollection___v1',
    files: [
      {
        bucket: 'cumulus-protected-bucket',
        fileName: 'fakeFileName.xml',
        key: 'fakePath/fakeFileName.xml',
      },
      {
        bucket: 'cumulus-protected-bucket',
        fileName: 'fakeFileName.hdf',
        key: 'fakePath/fakeFileName.hdf',
      },
    ],
  };
  return {
    fakeCollectionV1,
    fakeCollectionV2,
    matchingCumulusGran,
    matchingOrcaGran,
    matchingCumulusOnlyGran,
    conflictCumulusGran,
    conflictOrcaGran,
    cumulusOnlyGranNoFile,
    orcaOnlyGranule,
    conflictCumulusOnlyGran,
  };
}

test.beforeEach(async (t) => {
  t.context.stackName = randomId('stack');
  t.context.systemBucket = randomId('bucket');
  process.env.system_bucket = t.context.systemBucket;

  // Setup Postgres DB

  t.context.testDbName = `orca_backup_recon_${cryptoRandomString({ length: 10 })}`;
  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir,
    { dbMaxPool: 10 }
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granulePgModel = new GranulePgModel();
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();
  t.context.filePgModel = new FilePgModel();

  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: t.context.testDbName,
    dbMaxPool: 10,
  };
});

test.afterEach.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
  });
});

test.serial('shouldFileBeExcludedFromOrca returns true for configured file types', (t) => {
  const collectionsConfig = {
    collectionId1: {
      orca: {
        excludedFileExtensions: ['.xml', '.met'],
      },
    },
  };
  t.true(shouldFileBeExcludedFromOrca(collectionsConfig, 'collectionId1', `${randomId('file')}.xml`));
  t.true(shouldFileBeExcludedFromOrca(collectionsConfig, 'collectionId1', `${randomId('file')}.met`));
  t.false(shouldFileBeExcludedFromOrca(collectionsConfig, 'collectionId1', `${randomId('file')}.hdf`));
  t.false(shouldFileBeExcludedFromOrca(collectionsConfig, 'collectionId1', randomId('file')));

  t.false(shouldFileBeExcludedFromOrca(collectionsConfig, `${randomId('coll')}`, `${randomId('file')}.xml`));
  t.false(shouldFileBeExcludedFromOrca(collectionsConfig, `${randomId('coll')}`, `${randomId('file')}.met`));
  t.false(shouldFileBeExcludedFromOrca(collectionsConfig, `${randomId('coll')}`, randomId('file')));
});

test.serial('getReportForOneGranule reports ok for one granule in both cumulus and orca with no file discrepancy', async (t) => {
  const { knex } = t.context;
  const collectionsConfig = {};
  const {
    matchingCumulusGran: cumulusGranule,
    matchingOrcaGran: orcaGranule,
  } = fakeCollectionsAndGranules();
  const report = await getReportForOneGranule({
    collectionsConfig,
    cumulusGranule,
    orcaGranule,
    knex,
  });
  t.true(report.ok);
  t.is(report.okFilesCount, 1);
  t.is(report.cumulusFilesCount, 1);
  t.is(report.orcaFilesCount, 1);
  t.is(report.conflictFiles.length, 0);
});

test.serial('getReportForOneGranule reports no ok for one granule in both cumulus and orca with file discrepancy', async (t) => {
  const { knex } = t.context;

  const collectionsConfig = {
    fakeCollection___v1: {
      orca: {
        excludedFileExtensions: ['.xml', '.met'],
      },
    },
  };

  const granules = fakeCollectionsAndGranules();
  const cumulusGranule = translateTestGranuleObject(granules.conflictCumulusGran);
  const orcaGranule = translateTestGranuleObject(granules.conflictOrcaGran);

  const report = await getReportForOneGranule({
    collectionsConfig,
    cumulusGranule,
    orcaGranule,
    knex,
  });
  t.false(report.ok);
  t.is(report.okFilesCount, 2);
  t.is(report.cumulusFilesCount, 4);
  t.is(report.orcaFilesCount, 3);
  t.is(report.conflictFiles.length, 3);
  t.is(
    report.conflictFiles.filter((file) =>
      file.fileName.endsWith('.xml') && file.reason === fileConflictTypes.shouldBeExcludedFromOrca).length,
    1
  );
  t.is(
    report.conflictFiles.filter((file) =>
      file.fileName.endsWith('onlyInCumulus.jpg') && file.reason === fileConflictTypes.onlyInCumulus).length,
    1
  );
  t.is(
    report.conflictFiles.filter((file) =>
      file.fileName.endsWith('onlyInOrca.jpg') && file.reason === fileConflictTypes.onlyInOrca).length,
    1
  );
});

test.serial('getReportForOneGranule reports ok for one granule in cumulus only with all files excluded from orca', (t) => {
  const collectionsConfig = {
    fakeCollection___v1: {
      orca: {
        excludedFileExtensions: ['.xml', '.met'],
      },
    },
  };

  const granules = fakeCollectionsAndGranules();
  const cumulusGranule = translateTestGranuleObject(granules.matchingCumulusOnlyGran);

  const report = getReportForOneGranule({ collectionsConfig, cumulusGranule });
  t.true(report.ok);
  t.is(report.okFilesCount, 2);
  t.is(report.cumulusFilesCount, 2);
  t.is(report.orcaFilesCount, 0);
  t.is(report.conflictFiles.length, 0);
});

test.serial('getReportForOneGranule reports not ok for one granule in cumulus only with files should be in orca', (t) => {
  const collectionsConfig = {
    fakeCollection___v1: {
      orca: {
        excludedFileExtensions: ['.xml', '.met'],
      },
    },
  };

  const granules = fakeCollectionsAndGranules();
  const cumulusGranule = translateTestGranuleObject(granules.conflictCumulusOnlyGran);

  const report = getReportForOneGranule({ collectionsConfig, cumulusGranule });
  t.false(report.ok);
  t.is(report.okFilesCount, 1);
  t.is(report.cumulusFilesCount, 2);
  t.is(report.orcaFilesCount, 0);
  t.is(report.conflictFiles.length, 1);
});

test.serial('getReportForOneGranule reports ok for one granule in cumulus only with no files', (t) => {
  const collectionsConfig = {};

  const granules = fakeCollectionsAndGranules();
  const cumulusGranule = translateTestGranuleObject(granules.cumulusOnlyGranNoFile);

  const report = getReportForOneGranule({ collectionsConfig, cumulusGranule });
  t.true(report.ok);
  t.is(report.okFilesCount, 0);
  t.is(report.cumulusFilesCount, 0);
  t.is(report.orcaFilesCount, 0);
  t.is(report.conflictFiles.length, 0);
});

test.serial('orcaReconciliationReportForGranules reports discrepancy of granule holdings in cumulus and orca', async (t) => {
  const { collectionPgModel, granulePgModel, filePgModel, knex } = t.context;
  const {
    fakeCollectionV1,
    fakeCollectionV2,
    conflictCumulusGran,
    conflictOrcaGran,
    cumulusOnlyGranNoFile,
    orcaOnlyGranule,
    matchingCumulusGran,
    matchingOrcaGran,
    matchingCumulusOnlyGran,
    conflictCumulusOnlyGran,
  } = fakeCollectionsAndGranules();

  // Create provider
  const fakeProvider = fakeProviderRecordFactory({ name: 'fakeProvider' });
  const fakeProvider2 = fakeProviderRecordFactory({ name: 'fakeProvider2' });
  const providerPgModel = new ProviderPgModel();
  await Promise.all(
    [fakeProvider, fakeProvider2].map((p) =>
      providerPgModel.create(knex, p))
  );

  // Create collections
  const pgCollections = await Promise.all(
    [fakeCollectionV1, fakeCollectionV2].map((c) => translateApiCollectionToPostgresCollection(c))
  );
  await Promise.all(
    pgCollections.map((collection) => collectionPgModel.create(knex, collection))
  );

  const apiGranules = [
    cumulusOnlyGranNoFile,
    conflictCumulusGran,
    matchingCumulusGran,
    matchingCumulusOnlyGran,
    conflictCumulusOnlyGran,
  ];

  // Create granules
  await Promise.all(
    apiGranules.map(async (granule) => {
      const pgGranule = await translateApiGranuleToPostgresGranule({
        dynamoRecord: granule,
        knexOrTransaction: knex,
      });
      const pgRecord = await granulePgModel.create(knex, pgGranule);
      if (!granule.files) {
        return;
      }
      const pgFiles = granule.files.map((f) => (translateApiFiletoPostgresFile(f)));
      await Promise.all(
        pgFiles.map(async (f) => await filePgModel.create(knex, {
          ...f,
          granule_cumulus_id: pgRecord[0].cumulus_id,
        }))
      );
    })
  );

  const orcaGranules = sortBy([conflictOrcaGran, orcaOnlyGranule, matchingOrcaGran], ['id', 'collectionId']);
  const searchOrcaStub = sinon.stub(ORCASearchCatalogQueue.prototype, 'searchOrca');
  searchOrcaStub.resolves({ anotherPage: false, granules: orcaGranules });

  const granulesReport = await orcaReconciliationReportForGranules({});
  ORCASearchCatalogQueue.prototype.searchOrca.restore();
  // matchingCumulusGran, matchingCumulusOnlyGran, cumulusOnlyGranNoFile
  t.is(granulesReport.okCount, 3);
  t.is(granulesReport.cumulusCount, 5);
  // conflictOrcaGran, orcaOnlyGr 5anule, matchingOrcaGran,
  t.is(granulesReport.orcaCount, 3);
  // matchingCumulusGran has 1, matchingCumulusOnlyGran 2,
  // conflictCumulusGran 2, conflictCumulusOnlyGran 1
  t.is(granulesReport.okFilesCount, 6);
  t.is(granulesReport.cumulusFilesCount, 9);
  t.is(granulesReport.orcaFilesCount, 4);
  // conflictCumulusGran 3 , conflictCumulusOnlyGran 1
  t.is(granulesReport.conflictFilesCount, 4);
  // conflictCumulusGran
  t.is(granulesReport.withConflicts.length, 1);
  // conflictCumulusOnlyGran
  t.is(granulesReport.onlyInCumulus.length, 1);
  // orcaOnlyGranule
  t.is(granulesReport.onlyInOrca.length, 1);
});
