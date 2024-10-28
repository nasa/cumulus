'use strict';

const test = require('ava');
const rewire = require('rewire');
const sinon = require('sinon');
const sortBy = require('lodash/sortBy');

const { randomId } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const indexer = require('@cumulus/es-client/indexer');
const { getEsClient } = require('@cumulus/es-client/search');

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

let esAlias;
let esIndex;
let esClient;

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

  // granule is in cumulus only, should not be in orca, and conform to configuratio
  const matchingCumulusOnlyGran = {
    ...fakeGranuleFactoryV2(),
    granuleId: randomId('matchingCumulusOnlyGranId'),
    collectionId: 'fakeCollection___v1',
    files: [
      {
        bucket: 'cumulus-protected-bucket',
        fileName: 'fakeFileName.xml',
        key: 'fakePath/fakeFileName.xml',
      },
      {
        bucket: 'cumulus-protected-bucket',
        fileName: 'fakeFileName.hdf.met',
        key: 'fakePath/fakeFileName.hdf.met',
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
        key: 'fakePath/fakeFileName.hdf',
      },
      {
        bucket: 'cumulus-private-bucket',
        fileName: 'fakeFileName.hdf.met',
        key: 'fakePath/fakeFileName.hdf.met',
      },
      {
        bucket: 'cumulus-fake-bucket',
        fileName: 'fakeFileName_onlyInCumulus.jpg',
        key: 'fakePath/fakeFileName_onlyInCumulus.jpg',
      },
      {
        bucket: 'cumulus-fake-bucket-2',
        fileName: 'fakeFileName.cmr.xml',
        key: 'fakePath/fakeFileName.cmr.xml',
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
        keyPath: 'fakePath/fakeFileName.hdf',
      },
      {
        name: 'fakeFileName_onlyInOrca.jpg',
        cumulusArchiveLocation: 'cumulus-fake-bucket',
        orcaArchiveLocation: 'orca-bucket',
        keyPath: 'fakePath/fakeFileName_onlyInOrca.jpg',
      },
      {
        name: 'fakeFileName.cmr.xml',
        cumulusArchiveLocation: 'cumulus-fake-bucket-2',
        orcaArchiveLocation: 'orca-bucket',
        keyPath: 'fakePath/fakeFileName.cmr.xml',
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

  esAlias = randomId('esalias');
  esIndex = randomId('esindex');
  process.env.ES_INDEX = esAlias;
  await bootstrapElasticSearch({
    host: 'fakehost',
    index: esIndex,
    alias: esAlias,
  });
  esClient = await getEsClient();
});

test.afterEach.always(async () => {
  await esClient.client.indices.delete({ index: esIndex });
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

test.serial('getReportForOneGranule reports ok for one granule in both cumulus and orca with no file discrepancy', (t) => {
  const collectionsConfig = {};
  const {
    matchingCumulusGran: cumulusGranule,
    matchingOrcaGran: orcaGranule,
  } = fakeCollectionsAndGranules();
  const report = getReportForOneGranule({ collectionsConfig, cumulusGranule, orcaGranule });
  t.true(report.ok);
  t.is(report.okFilesCount, 1);
  t.is(report.cumulusFilesCount, 1);
  t.is(report.orcaFilesCount, 1);
  t.is(report.conflictFiles.length, 0);
});

test.serial('getReportForOneGranule reports no ok for one granule in both cumulus and orca with file discrepancy', (t) => {
  const collectionsConfig = {
    fakeCollection___v1: {
      orca: {
        excludedFileExtensions: ['.xml', '.met'],
      },
    },
  };
  const {
    conflictCumulusGran: cumulusGranule,
    conflictOrcaGran: orcaGranule,
  } = fakeCollectionsAndGranules();
  const report = getReportForOneGranule({ collectionsConfig, cumulusGranule, orcaGranule });
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
  const {
    matchingCumulusOnlyGran: cumulusGranule,
  } = fakeCollectionsAndGranules();
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
  const {
    conflictCumulusOnlyGran: cumulusGranule,
  } = fakeCollectionsAndGranules();
  const report = getReportForOneGranule({ collectionsConfig, cumulusGranule });
  t.false(report.ok);
  t.is(report.okFilesCount, 1);
  t.is(report.cumulusFilesCount, 2);
  t.is(report.orcaFilesCount, 0);
  t.is(report.conflictFiles.length, 1);
});

test.serial('getReportForOneGranule reports ok for one granule in cumulus only with no files', (t) => {
  const collectionsConfig = {};
  const {
    cumulusOnlyGranNoFile: cumulusGranule,
  } = fakeCollectionsAndGranules();
  const report = getReportForOneGranule({ collectionsConfig, cumulusGranule });
  t.true(report.ok);
  t.is(report.okFilesCount, 0);
  t.is(report.cumulusFilesCount, 0);
  t.is(report.orcaFilesCount, 0);
  t.is(report.conflictFiles.length, 0);
});

test.serial('orcaReconciliationReportForGranules reports discrepancy of granule holdings in cumulus and orca', async (t) => {
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

  const esGranules = [
    cumulusOnlyGranNoFile,
    conflictCumulusGran,
    matchingCumulusGran,
    matchingCumulusOnlyGran,
    conflictCumulusOnlyGran,
  ];
  const esCollections = [fakeCollectionV1, fakeCollectionV2];

  // add granules and related collections to es and db
  await Promise.all(
    esCollections.map(async (collection) => {
      await indexer.indexCollection(esClient, collection, esAlias);
    })
  );
  await Promise.all(
    esGranules.map(async (granule) => {
      await indexer.indexGranule(esClient, granule, esAlias);
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
  // conflictOrcaGran, orcaOnlyGranule, matchingOrcaGran,
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
