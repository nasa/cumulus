const {
  promiseS3Upload,
  deleteS3Object,
} = require('@cumulus/aws-client/S3');
const {
  granules,
  collections,
} = require('@cumulus/api-client');

const path = require('path');
const fs = require('fs');
const { constructCollectionId } = require('../../../../packages/message/Collections');

const getTargetFiles = (targetUrlPrefix, config) => [
  {
    bucket: config.buckets.protected.name,
    key: `${targetUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.hdf`,
  },
  {
    bucket: config.buckets.public.name,
    key: `${targetUrlPrefix}/jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
  },
  {
    bucket: config.buckets.public.name,
    key: `${targetUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
  },
  {
    bucket: config.buckets.public.name,
    key: `${targetUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`,
  },
];

const getSourceCollection = (sourceUrlPrefix) => (
  {
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
        bucket: 'protected',
      },
      {
        regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
        sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
        bucket: 'public',
      },
      {
        regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
        sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
        bucket: 'private',
      },
    ],
    url_path: sourceUrlPrefix,
    name: 'MOD11A1',
    granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
    granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
    dataType: 'MOD11A1',
    process: 'modis',
    version: '006',
    sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
    id: 'MOD11A1',
  }
);

const getTargetCollection = (targetUrlPrefix) => ({
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
      url_path: `${targetUrlPrefix}/jpg/example2/`,
    },
  ],
  url_path: targetUrlPrefix,
  name: 'MOD11A2',
  granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
  granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
  dataType: 'MOD11A2',
  process: 'modis',
  version: '006',
  sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  id: 'MOD11A2',
});

const getProcessGranule = (sourceUrlPrefix, config) => ({
  status: 'completed',
  collectionId: 'MOD11A1___006',
  granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
  files: [
    {
      key: `${sourceUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.hdf`,
      bucket: config.buckets.protected.name,
      type: 'data',
      fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
    },
    {
      key: `${sourceUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
      bucket: config.buckets.private.name,
      type: 'browse',
      fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
    },
    {
      key: `${sourceUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
      bucket: config.buckets.public.name,
      type: 'browse',
      fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
    },
    {
      key: `${sourceUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`,
      bucket: config.buckets.protected.name,
      type: 'metadata',
      fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
    },
  ],
});

const setupInitialState = async (stackName, sourceUrlPrefix, targetUrlPrefix, config) => {
  const sourceCollection = getSourceCollection(sourceUrlPrefix);
  const targetCollection = getTargetCollection(targetUrlPrefix);
  try {
    await collections.createCollection({
      prefix: stackName,
      collection: sourceCollection,
    });
  } catch {
    console.log(`collection ${constructCollectionId(sourceCollection.name, sourceCollection.version)} already exists`);
  }
  try {
    await collections.createCollection({
      prefix: stackName,
      collection: targetCollection,
    });
  } catch {
    console.log(`collection ${constructCollectionId(targetCollection.name, targetCollection.version)} already exists`);
  }
  const processGranule = getProcessGranule(sourceUrlPrefix, config);
  try {
    await granules.createGranule({
      prefix: stackName,
      body: processGranule,
    });
  } catch {
    console.log(`granule ${processGranule.granuleId} already exists`);
  }
  await Promise.all(processGranule.files.map(async (file) => {
    let body;
    if (file.type === 'metadata') {
      body = fs.createReadStream(path.join(__dirname, 'data/meta.xml'));
    } else {
      body = file.key;
    }
    await promiseS3Upload({
      params: {
        Bucket: file.bucket,
        Key: file.key,
        Body: body,
      },
    });
  }));
  const finalFiles = getTargetFiles(targetUrlPrefix, config);
  await Promise.all(finalFiles.map((fileObj) => {
    try {
      return deleteS3Object(
        fileObj.bucket,
        fileObj.key
      );
    } catch (error) {
      console.log(error);
    }
    return null;
  }));
};

const getPayload = (sourceUrlPrefix, targetUrlPrefix, config) => ({
  meta: {
    targetCollection: getTargetCollection(targetUrlPrefix),
    collection: getSourceCollection(sourceUrlPrefix),
    buckets: config.buckets,
  },
  config: {
    buckets: '{$.meta.buckets}',
    distribution_endpoint: 'https://something.api.us-east-1.amazonaws.com/',
    collection: '{$.meta.collection}',
    targetCollection: '{$.meta.targetCollection}',
  },
  input: {
    granuleIds: [
      getProcessGranule(sourceUrlPrefix, config).granuleId,
    ],
  },
});

module.exports = {
  getSourceCollection,
  getTargetCollection,
  getProcessGranule,
  setupInitialState,
  getPayload,
  getTargetFiles,
};
