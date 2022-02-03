'use strict';

const test = require('ava');
const rewire = require('rewire');
const sinon = require('sinon');
const sortBy = require('lodash/sortBy');
const { randomId } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const indexer = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');

const {
  fakeCollectionFactory,
  fakeGranuleFactoryV2,
} = require('../../lib/testUtils');
const { fileConflictTypes, reconciliationReportForGranules } = require('../../lambdas/backup-reconciliation-report');
const BRP = rewire('../../lambdas/backup-reconciliation-report');
const ORCASearchCatalogQueue = require('../../lib/ORCASearchCatalogQueue');
const isFileExcludedFromOrca = BRP.__get__('isFileExcludedFromOrca');
const getReportForOneGranule = BRP.__get__('getReportForOneGranule');

let esAlias;
let esIndex;
let esClient;

function fakeOrcaGranuleFactory(options = {}) {
  return {
    providerId: randomId('providerId'),
    collectionId: 'fakeCollection___v1',
    id: randomId('id'),
    createdAt: Date.now(),
    ingestDate: Date.now(),
    lastUpdate: Date.now(),
    files: [
      {
        name: randomId('name'),
        cumulusArchiveLocation: randomId('cumulusArchiveLocation'),
        orcaArchiveLocation: randomId('orcaArchiveLocation'),
        keyPath: randomId('keyPath'),
      },
    ],
    ...options,
  };
}

function fakeCollectionsAndGranules() {
  const fakeCollectionV1 = fakeCollectionFactory({
    name: 'fakeCollection',
    version: 'v1',
    meta: {
      excludeFileTypes: ['.xml', '.met'],
    },
  });
  const fakeCollectionV2 = fakeCollectionFactory({
    name: 'fakeCollection',
    version: 'v2',
  });
  const mismatchedCumulusGranule = {
    ...fakeGranuleFactoryV2(),
    granuleId: randomId('mismatchedGranuleId'),
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
        bucket: 'cumulus-public-bucket',
        fileName: 'fakeFileName_onlyInCumulus.jpg',
        key: 'fakePath/fakeFileName_onlyInCumulus.jpg',
      },
      {
        bucket: 'cumulus-protected-2-bucket',
        fileName: 'fakeFileName.cmr.xml',
        key: 'fakePath/fakeFileName.cmr.xml',
      },
    ],
  };
  const mismatchedOrcaGranule = {
    ...fakeOrcaGranuleFactory(),
    providerId: mismatchedCumulusGranule.provider,
    collectionId: mismatchedCumulusGranule.collectionId,
    id: mismatchedCumulusGranule.granuleId,
    files: [
      {
        name: 'fakeFileName.hdf',
        cumulusArchiveLocation: 'cumulus-protected-bucket',
        orcaArchiveLocation: 'orca-bucket',
        keyPath: 'fakePath/fakeFileName.hdf',
      },
      {
        name: 'fakeFileName_onlyInOrca.jpg',
        cumulusArchiveLocation: 'cumulus-public-bucket',
        orcaArchiveLocation: 'orca-bucket',
        keyPath: 'fakePath/fakeFileName_onlyInOrca.jpg',
      },
      {
        name: 'fakeFileName.cmr.xml',
        cumulusArchiveLocation: 'cumulus-protected-2-bucket',
        orcaArchiveLocation: 'orca-bucket',
        keyPath: 'fakePath/fakeFileName.cmr.xml',
      },
    ],
  };
  const cumulusOnlyGranule = fakeGranuleFactoryV2();
  const orcaOnlyGranule = fakeOrcaGranuleFactory();
  const matchedCumulusGranule = {
    ...fakeGranuleFactoryV2(),
    granuleId: randomId('matchedGranuleId'),
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

  const matchedOrcaGranule = {
    ...fakeOrcaGranuleFactory(),
    providerId: matchedCumulusGranule.provider,
    collectionId: matchedCumulusGranule.collectionId,
    id: matchedCumulusGranule.granuleId,
    files: [
      {
        name: 'fakeFileName2.hdf',
        cumulusArchiveLocation: 'cumulus-protected-bucket2',
        orcaArchiveLocation: 'orca-bucket2',
        keyPath: 'fakePath2/fakeFileName2.hdf',
      },
    ],
  };

  const matchedCumulusOnlyGranule = {
    ...fakeGranuleFactoryV2(),
    granuleId: randomId('matchedCumulusOnlyGranuleId'),
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

  const mismatchedCumulusOnlyGranule = {
    ...fakeGranuleFactoryV2(),
    granuleId: randomId('mismatchedCumulusOnlyGranuleId'),
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
    mismatchedCumulusGranule,
    mismatchedOrcaGranule,
    cumulusOnlyGranule,
    orcaOnlyGranule,
    matchedCumulusGranule,
    matchedOrcaGranule,
    matchedCumulusOnlyGranule,
    mismatchedCumulusOnlyGranule,
  };
}

test.beforeEach(async (t) => {
  t.context.stackName = randomId('stack');
  t.context.systemBucket = randomId('systembucket');
  process.env.system_bucket = t.context.systemBucket;

  esAlias = randomId('esalias');
  esIndex = randomId('esindex');
  process.env.ES_INDEX = esAlias;
  await bootstrapElasticSearch('fakehost', esIndex, esAlias);
  esClient = await Search.es();
});

test.afterEach.always(async () => {
  await esClient.indices.delete({ index: esIndex });
});

test.serial('isFileExcludedFromOrca returns true for configured file types', (t) => {
  const collectionsConfig = {
    collectionId1: {
      orca: {
        excludeFileTypes: ['.xml', '.met'],
      },
    },
  };
  t.true(isFileExcludedFromOrca(collectionsConfig, 'collectionId1', `${randomId('file')}.xml`));
  t.true(isFileExcludedFromOrca(collectionsConfig, 'collectionId1', `${randomId('file')}.met`));
  t.false(isFileExcludedFromOrca(collectionsConfig, 'collectionId1', `${randomId('file')}.hdf`));
  t.false(isFileExcludedFromOrca(collectionsConfig, 'collectionId1', randomId('file')));

  t.false(isFileExcludedFromOrca(collectionsConfig, `${randomId('coll')}`, `${randomId('file')}.xml`));
  t.false(isFileExcludedFromOrca(collectionsConfig, `${randomId('coll')}`, `${randomId('file')}.met`));
  t.false(isFileExcludedFromOrca(collectionsConfig, `${randomId('coll')}`, randomId('file')));
});

test.serial('getReportForOneGranule reports ok for one granule in both cumulus and orca with no file discrepancy', (t) => {
  const collectionsConfig = {};
  const {
    matchedCumulusGranule: cumulusGranule,
    matchedOrcaGranule: orcaGranule,
  } = fakeCollectionsAndGranules();
  const report = getReportForOneGranule({ collectionsConfig, cumulusGranule, orcaGranule });
  console.log(report);
  t.true(report.ok);
  t.is(report.okFilesCount, 1);
  t.is(report.mismatchedFiles.length, 0);
});

test.serial('getReportForOneGranule reports no ok for one granule in both cumulus and orca with file discrepancy', (t) => {
  const collectionsConfig = {
    fakeCollection___v1: {
      orca: {
        excludeFileTypes: ['.xml', '.met'],
      },
    },
  };
  const {
    mismatchedCumulusGranule: cumulusGranule,
    mismatchedOrcaGranule: orcaGranule,
  } = fakeCollectionsAndGranules();
  const report = getReportForOneGranule({ collectionsConfig, cumulusGranule, orcaGranule });
  console.log(report);
  t.false(report.ok);
  t.is(report.okFilesCount, 2);
  t.is(report.mismatchedFiles.length, 3);
  t.is(
    report.mismatchedFiles.filter((file) =>
      file.fileName.endsWith('.xml') && file.reason === fileConflictTypes.shouldExcludedFromOrca).length,
    1
  );
  t.is(
    report.mismatchedFiles.filter((file) =>
      file.fileName.endsWith('onlyInCumulus.jpg') && file.reason === fileConflictTypes.onlyInCumulus).length,
    1
  );
  t.is(
    report.mismatchedFiles.filter((file) =>
      file.fileName.endsWith('onlyInOrca.jpg') && file.reason === fileConflictTypes.onlyInOrca).length,
    1
  );
});

test.serial('getReportForOneGranule reports ok for one granule in cumulus only with all files excluded from orca', (t) => {
  const collectionsConfig = {
    fakeCollection___v1: {
      orca: {
        excludeFileTypes: ['.xml', '.met'],
      },
    },
  };
  const {
    matchedCumulusOnlyGranule: cumulusGranule,
  } = fakeCollectionsAndGranules();
  const report = getReportForOneGranule({ collectionsConfig, cumulusGranule });
  console.log(report);
  t.true(report.ok);
  t.is(report.okFilesCount, 2);
  t.is(report.mismatchedFiles.length, 0);
});

test.serial('getReportForOneGranule reports not ok for one granule in cumulus only with files should be in orca', (t) => {
  const collectionsConfig = {
    fakeCollection___v1: {
      orca: {
        excludeFileTypes: ['.xml', '.met'],
      },
    },
  };
  const {
    mismatchedCumulusOnlyGranule: cumulusGranule,
  } = fakeCollectionsAndGranules();
  const report = getReportForOneGranule({ collectionsConfig, cumulusGranule });
  console.log(report);
  t.false(report.ok);
  t.is(report.okFilesCount, 1);
  t.is(report.mismatchedFiles.length, 1);
});

test.serial('reconciliationReportForGranules reports discrepancy of granule holdings in cumulus and orca', async (t) => {
  const {
    fakeCollectionV1,
    fakeCollectionV2,
    mismatchedCumulusGranule,
    mismatchedOrcaGranule,
    cumulusOnlyGranule,
    orcaOnlyGranule,
    matchedCumulusGranule,
    matchedOrcaGranule,
    matchedCumulusOnlyGranule,
    mismatchedCumulusOnlyGranule,
  } = fakeCollectionsAndGranules();

  const esGranules = [
    cumulusOnlyGranule,
    mismatchedCumulusGranule,
    matchedCumulusGranule,
    matchedCumulusOnlyGranule,
    mismatchedCumulusOnlyGranule,
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

  const orcaGranules = sortBy([mismatchedOrcaGranule, orcaOnlyGranule, matchedOrcaGranule], ['id', 'collectionId']);
  const searchOrcaStub = sinon.stub(ORCASearchCatalogQueue.prototype, 'searchOrca');
  searchOrcaStub.resolves({ anotherPage: false, granules: orcaGranules });

  const { granulesReport } = await reconciliationReportForGranules({});
  console.log(granulesReport);
  ORCASearchCatalogQueue.prototype.searchOrca.restore();
  // matchedCumulusGranule and matchedCumulusOnlyGranule
  t.is(granulesReport.okCount, 2);
  // matchedCumulusGranule has 1, matchedCumulusOnlyGranule 2,
  // mismatchedCumulusGranule 2, mismatchedCumulusOnlyGranule 1
  t.is(granulesReport.okFilesCount, 6);
  // mismatchedCumulusGranule 3 , mismatchedCumulusOnlyGranule 1
  t.is(granulesReport.mismatchedFilesCount, 4);
  // cumulusOnlyGranule, mismatchedCumulusOnlyGranule
  t.is(granulesReport.onlyInCumulus.length, 2);
  // orcaOnlyGranule
  t.is(granulesReport.onlyInOrca.length, 1);
  // mismatchedCumulusGranule
  t.is(granulesReport.mismatchedGranules.length, 1);
});
