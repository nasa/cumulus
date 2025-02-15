'use strict';

const clone = require('lodash/clone');

const fs = require('fs');

const range = require('lodash/range');
const {
  promiseS3Upload,
  parseS3Uri,
} = require('@cumulus/aws-client/S3');
const { isECHO10Filename, isUMMGFilename } = require('@cumulus/cmrjs/cmr-utils');

const { constructCollectionId } = require('../../../packages/message/Collections');

async function uploadFiles(files) {
  await Promise.all(files?.map((file) => {
    let body;
    const parsedFile = parseS3Uri(file);
    if (isECHO10Filename(file)) {
      body = fs.createReadStream('tests/data/meta.cmr.xml');
    } else if (isUMMGFilename(file)) {
      body = fs.createReadStream('tests/data/ummg-meta.cmr.json');
    } else {
      body = parsedFile.Key.split('/').pop();
    }
    if (parsedFile.Bucket !== 'undefined' && parsedFile.Key !== 'undefined') {
      return promiseS3Upload({
        params: {
          ...parsedFile,
          Body: body,
        },
      });
    }
    return null;
  }));
}
function dummyGetCollection(collectionName, collectionVersion) {
  return {
    MOD11A1___001: {
      files: [
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'protected',
        },
        {
          regex: '^BROWSE\\.MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'BROWSE.MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf\\.met$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf.met',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.cmr\\.xml$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          bucket: 'public',
          url_path: 'jpg/example2/',
        },
      ],
      url_path: 'example2/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/',
      name: 'MOD11A1',
      granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
      granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
      dataType: 'MOD11A1',
      process: 'modis',
      version: '001',
      sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      id: 'MOD11A2',
    },
    MOD11A1___002: {
      files: [
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'protected',
        },
        {
          regex: '^BROWSE\\.MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'BROWSE.MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf\\.met$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf.met',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.cmr\\.xml$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          bucket: 'public',
          url_path: 'jpg/example2/',
        },
      ],
      url_path: 'example2/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/',
      name: 'MOD11A1',
      granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
      granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
      dataType: 'MOD11A1',
      process: 'modis',
      version: '002',
      sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      id: 'MOD11A1',
    },
    MOD11A1UMMG___001: {
      files: [
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'protected',
        },
        {
          regex: '^BROWSE\\.MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'BROWSE.MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf\\.met$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf.met',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.ummg\\.cmr\\.json$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.iso.xml',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          bucket: 'public',
          url_path: 'jpg/example2/',
        },
      ],
      url_path: 'example2/{extractYear(cmrMetadata.TemporalExtent.RangeDateTime.BeginningDateTime)}/',
      name: 'MOD11A1',
      granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
      granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
      dataType: 'MOD11A1',
      process: 'modis',
      version: '001',
      sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      id: 'MOD11A1',
    },
    MOD11A1UMMG___002: {
      files: [
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'protected',
        },
        {
          regex: '^BROWSE\\.MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'BROWSE.MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf\\.met$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf.met',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.ummg\\.cmr\\.json$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.iso.xml',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          bucket: 'public',
          url_path: 'jpg/example2/',
        },
      ],
      url_path: 'example2/{extractYear(cmrMetadata.TemporalExtent.RangeDateTime.BeginningDateTime)}/',
      name: 'MOD11A1',
      granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
      granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
      dataType: 'MOD11A1',
      process: 'modis',
      version: '002',
      sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      id: 'MOD11A1',
    },
    MOD11ANOMOVE___001: {
      files: [
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
          bucket: 'protected',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
          bucket: 'private',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
          bucket: 'public',
        },
        {
          regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.cmr\\.xml$',
          sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
          bucket: 'protected',
        },
      ],
      url_path: 'file-staging/subdir/',
      name: 'MOD11A1',
      granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
      granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
      dataType: 'MOD11A1',
      process: 'modis',
      version: '001',
      sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      id: 'MOD11A1',
    },
  }[constructCollectionId(collectionName, collectionVersion)];
}
// this is declared as a const outside the function so I can pre-load all those procedural granules
const granuleSet = {
  base_xml_granule: {
    status: 'completed',
    collectionId: 'MOD11A1___006',
    granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
    files: [
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
        bucket: 'protected',
        type: 'data',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
        bucket: 'private',
        type: 'browse',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
        bucket: 'public',
        type: 'browse',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
        bucket: 'protected',
        type: 'metadata',
      },
    ],
  },
  base_umm_granule: {
    status: 'completed',
    collectionId: 'MOD11A1___006',
    granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090725',
    files: [
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090725.hdf',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090725.hdf',
        bucket: 'protected',
        type: 'data',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090725_1.jpg',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090725_1.jpg',
        bucket: 'private',
        type: 'browse',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090725_2.jpg',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090725_2.jpg',
        bucket: 'public',
        type: 'browse',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090725.ummg.cmr.json',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090725.ummg.cmr.json',
        bucket: 'protected',
        type: 'metadata',
      },
    ],
  },
  bad_granule: {
    status: 'completed',
    collectionId: 'MOD11A1___006',
    granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
    files: [
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
        type: 'data',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
        bucket: 'private',
        type: 'browse',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
        bucket: 'public',
        type: 'browse',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
        bucket: 'protected',
        type: 'metadata',
      },
    ],
  },
  empty_xml_granule: {
    status: 'completed',
    collectionId: 'MOD11A1___006',
    granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
    files: [],
  },
  undef_files_xml_granule: {
    status: 'completed',
    collectionId: 'MOD11A1___006',
    granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
  },
  missing_fileName: {
    status: 'completed',
    collectionId: 'MOD11A1___006',
    granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
    files: [
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
        bucket: 'protected',
        type: 'data',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
        bucket: 'private',
        type: 'browse',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
        bucket: 'public',
        type: 'browse',
      },
      {
        key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
        bucket: 'protected',
        type: 'metadata',
      },
    ],
  },
};
range(111).forEach((i) => {
  const baseGranuleString = JSON.stringify(
    granuleSet.base_xml_granule
  ).replaceAll('90724', `${('0000' + i).slice(-5)}`);
  granuleSet[`xml_granule${i}`] = JSON.parse(baseGranuleString);
});

function dummyGetGranule(granuleId, t) {
  const granuleOut = clone(granuleSet[granuleId]);
  granuleOut.files = granuleOut.files?.map((file) => ({
    ...file,
    bucket: t.context.bucketMapping[file.bucket],
  }));
  return granuleOut;
}

module.exports = {
  dummyGetCollection,
  dummyGetGranule,
  uploadFiles,
};
