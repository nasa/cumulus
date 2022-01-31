'use strict';

const test = require('ava');
const rewire = require('rewire');
const { randomId } = require('@cumulus/common/test-utils');
const {
  fakeCollectionFactory,
  fakeGranuleFactoryV2,
} = require('../../lib/testUtils');
const { fileConflictTypes } = require('../../lambdas/backup-reconciliation-report');
const BRP = rewire('../../lambdas/backup-reconciliation-report');
const isFileExcludedFromOrca = BRP.__get__('isFileExcludedFromOrca');
const getReportForOneGranule = BRP.__get__('getReportForOneGranule');

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
  return {
    fakeCollectionV1,
    fakeCollectionV2,
    mismatchedCumulusGranule,
    mismatchedOrcaGranule,
    cumulusOnlyGranule,
    orcaOnlyGranule,
    matchedCumulusGranule,
    matchedOrcaGranule,
  };
}

test('isFileExcludedFromOrca returns true for configured file types', (t) => {
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

test('getReportForOneGranule returns correctly report for one granule', (t) => {
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
