'use strict';

const test = require('ava');
const rewire = require('rewire');

const { randomId } = require('@cumulus/common/test-utils');

const BRP = rewire('../../lambdas/backup-reconciliation-report');

const isFileExcludedFromOrca = BRP.__get__('isFileExcludedFromOrca');
const getReportForOneGranule = BRP.__get__('getReportForOneGranule');

test(
  'isFileExcludedFromOrca returns true for configured file types',
  (t) => {
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
  }
);

test(
  'getReportForOneGranule returns correctly report for one granule',
  (t) => {
    const collectionsConfig = {
      MOD09GQ___006: {
        orca: {
          excludeFileTypes: ['.xml', '.met'],
        },
      },
    };
    const cumulusGranule = {
      granuleId: 'MOD09GQ.A6234296.y7NKhU.006.6485037861919',
      published: true,
      endingDateTime: '2017-11-08T23:59:59Z',
      status: 'completed',
      timestamp: 1642023043324,
      createdAt: 1642022894982,
      processingEndDateTime: '2022-01-12T21:30:42.498Z',
      productVolume: 1131790,
      timeToPreprocess: 0,
      timeToArchive: 0,
      productionDateTime: '2018-07-19T12:01:01Z',
      cmrLink: 'https://cmr.uat.earthdata.nasa.gov/search/concepts/G1243108159-CUMULUS.echo10',
      execution: 'fakeExeuctionLink',
      files: [
        {
          bucket: 'cumulus-protected-bucket',
          fileName: 'MOD09GQ.A6234296.y7NKhU.006.6485037861919.hdf',
          size: 1098034,
          checksumType: 'md5',
          checksum: '8d1ec5c0463e59d26adee87cdbbee816',
          source: 'test-data/files/MOD09GQ.A6234296.y7NKhU.006.6485037861919.hdf',
          type: 'data',
          key: 'MOD09GQ___006/2017/MOD/123/MOD09GQ.A6234296.y7NKhU.006.6485037861919.hdf',
        },
        {
          bucket: 'cumulus-private-bucket',
          fileName: 'MOD09GQ.A6234296.y7NKhU.006.6485037861919.hdf.met',
          size: 21708,
          checksumType: 'md5',
          checksum: '39b0cb4a65406f88a54ee691e6ab05f2',
          source: 'test-data/files/MOD09GQ.A6234296.y7NKhU.006.6485037861919.hdf.met',
          type: 'metadata',
          key: 'MOD09GQ___006/MOD/123/MOD09GQ.A6234296.y7NKhU.006.6485037861919.hdf.met',
        },
        {
          bucket: 'cumulus-public-bucket',
          fileName: 'MOD09GQ.A6234296.y7NKhU.006.6485037861919_ndvi.jpg',
          size: 9728,
          checksumType: 'md5',
          checksum: '011c36e0adefd0d93ee2bfdc794a2a89',
          source: 'test-data/files/MOD09GQ.A6234296.y7NKhU.006.6485037861919_ndvi.jpg',
          type: 'browse',
          key: 'MOD09GQ___006/MOD/123/MOD09GQ.A6234296.y7NKhU.006.6485037861919_ndvi.jpg',
        },
        {
          bucket: 'cumulus-protected-2-bucket',
          fileName: 'MOD09GQ.A6234296.y7NKhU.006.6485037861919.cmr.xml',
          size: 2320,
          type: 'metadata',
          key: 'MOD09GQ___006/MOD/123/MOD09GQ.A6234296.y7NKhU.006.6485037861919.cmr.xml',
        },
      ],
      processingStartDateTime: '2022-01-12T21:30:28.721Z',
      updatedAt: 1642023043324,
      beginningDateTime: '2017-10-24T00:00:00Z',
      provider: 'fakeProvider',
      collectionId: 'MOD09GQ___006',
      duration: 15.605,
      error: {},
      lastUpdateDateTime: '2018-04-25T21:45:45.524053',
    };
    const orcaGranule = {
      providerId: 'fakeProvider',
      collectionId: 'MOD09GQ___006',
      id: 'MOD09GQ.A6234296.y7NKhU.006.6485037861919',
      createdAt: 1642544669929,
      executionId: 'fakeExecutionId',
      ingestDate: 1642544689906,
      lastUpdate: 1642544689906,
      files: [
        {
          name: 'MOD09GQ.A6234296.y7NKhU.006.6485037861919.hdf',
          cumulusArchiveLocation: 'cumulus-protected-bucket',
          orcaArchiveLocation: 'orca-bucket',
          keyPath: 'MOD09GQ___006/2017/MOD/123/MOD09GQ.A6234296.y7NKhU.006.6485037861919.hdf',
          sizeBytes: 1098034,
          hash: '8d1ec5c0463e59d26adee87cdbbee816',
          hashType: 'md5',
          version: 'null',
        },
        {
          name: 'MOD09GQ.A6234296.y7NKhU.006.6485037861919_ndvi.jpg',
          cumulusArchiveLocation: 'cumulus-public-bucket',
          orcaArchiveLocation: 'orca-bucket',
          keyPath: 'MOD09GQ___006/MOD/123/MOD09GQ.A6234296.y7NKhU.006.6485037861919_ndvi.jpg',
          sizeBytes: 9728,
          hash: '011c36e0adefd0d93ee2bfdc794a2a89',
          hashType: 'md5',
          version: 'null',
        },
        {
          name: 'MOD09GQ.A6234296.y7NKhU.006.6485037861919.cmr.xml',
          cumulusArchiveLocation: 'cumulus-protected-2-bucket',
          orcaArchiveLocation: 'orca-bucket',
          keyPath: 'MOD09GQ___006/MOD/123/MOD09GQ.A6234296.y7NKhU.006.6485037861919.cmr.xml',
          sizeBytes: 5325,
          hash: null,
          hashType: null,
          version: 'null',
        },
      ],
    };
    const report = getReportForOneGranule({ collectionsConfig, cumulusGranule, orcaGranule });
    console.log(report);
  }
);
