'use strict';

const { InvokeCommand } = require('@aws-sdk/client-lambda');
const { lambda } = require('@cumulus/aws-client/services');
const {
  promiseS3Upload,
  deleteS3Object,
} = require('@cumulus/aws-client/S3');
const { waitForListObjectsV2ResultCount } = require('@cumulus/integration-tests');
const {
  granules,
  collections,
} = require('@cumulus/api-client');

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { loadConfig } = require('../../helpers/testUtils');
const { constructCollectionId } = require('../../../../packages/message/Collections');
describe('when moveGranulesCollection is called', () => {
  let stackName;
  const sourceUrlPrefix = `source_path/${uuidv4()}`;
  const targetUrlPrefix = `target_path/${uuidv4()}`;
  const originalCollection = {
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
    url_path: targetUrlPrefix,
    name: 'MOD11A1',
    granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
    granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
    dataType: 'MOD11A1',
    process: 'modis',
    version: '006',
    sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
    id: 'MOD11A1',
  };
  const targetCollection = {
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
  };
  const processGranule = {
    status: 'completed',
    collectionId: 'MOD11A1___006',
    granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
    files: [
      {
        key: `${sourceUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.hdf`,
        bucket: 'cumulus-test-sandbox-protected',
        type: 'data',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      },
      {
        key: `${sourceUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
        bucket: 'cumulus-test-sandbox-private',
        type: 'browse',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
      },
      {
        key: `${sourceUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
        bucket: 'cumulus-test-sandbox-public',
        type: 'browse',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
      },
      {
        key: `${sourceUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`,
        bucket: 'cumulus-test-sandbox-protected',
        type: 'metadata',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
      },
    ],
  };
  // let systemBucket;
  beforeAll(async () => {
    const config = await loadConfig();
    stackName = config.stackName;
  });

  describe('under normal circumstances', () => {
    let beforeAllFailed;
    let finalFiles;
    afterAll(async () => {
      await Promise.all(finalFiles.map((fileObj) => deleteS3Object(
        fileObj.bucket,
        fileObj.key
      )));
    });
    beforeAll(async () => {
      finalFiles = [
        {
          bucket: 'cumulus-test-sandbox-protected',
          key: `${targetUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.hdf`,
        },
        {
          bucket: 'cumulus-test-sandbox-public',
          key: `${targetUrlPrefix}/jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
        },
        {
          bucket: 'cumulus-test-sandbox-public',
          key: `${targetUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
        },
        {
          bucket: 'cumulus-test-sandbox-public',
          key: `${targetUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`,
        },
      ];

      const payload = {
        meta: {
          collection: targetCollection,
          buckets: {
            internal: {
              type: 'cumulus-test-sandbox-internal',
            },
            private: {
              name: 'cumulus-test-sandbox-private',
              type: 'private',
            },
            protected: {
              name: 'cumulus-test-sandbox-protected',
              type: 'protected',
            },
            public: {
              name: 'cumulus-test-sandbox-public',
              type: 'public',
            },
          },
        },
        config: {
          buckets: '{$.meta.buckets}',
          distribution_endpoint: 'https://something.api.us-east-1.amazonaws.com/',
          collection: '{$.meta.collection}',
        },
        input: {
          granules: [
            processGranule,
          ],
        },
      };
      //upload to cumulus
      try {
        try {
          await collections.createCollection({
            prefix: stackName,
            collection: originalCollection,
          });
        } catch {
          console.log(`collection ${constructCollectionId(originalCollection.name, originalCollection.version)} already exists`);
        }
        try {
          await collections.createCollection({
            prefix: stackName,
            collection: targetCollection,
          });
        } catch {
          console.log(`collection ${constructCollectionId(targetCollection.name, targetCollection.version)} already exists`);
        }
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
        const { $metadata } = await lambda().send(new InvokeCommand({
          FunctionName: `${stackName}-MoveGranuleCollections`,
          InvocationType: 'RequestResponse',
          Payload: JSON.stringify({
            cma: {
              meta: payload.meta,
              task_config: payload.config,
              event: {
                payload: payload.input,
              },
            },
          }),
        }));
        console.log($metadata.httpStatusCode);
        if ($metadata.httpStatusCode >= 400) {
          console.log(`lambda invocation to set up failed, code ${$metadata.httpStatusCode}`);
          beforeAllFailed = true;
        }

        await Promise.all(finalFiles.map((file) => expectAsync(
          waitForListObjectsV2ResultCount({
            bucket: file.bucket,
            prefix: file.key,
            desiredCount: 1,
            interval: 5 * 1000,
            timeout: 30 * 1000,
          })
        ).toBeResolved()));
      } catch (error) {
        console.log(`files do not appear to have been moved: error: ${error}`);
        beforeAllFailed = false;
      }
    });
    it('moves the granule data in s3', () => {
      if (beforeAllFailed) fail('beforeAllFailed');
    });
    it('updates the granule data in cumulus', async () => {
      if (beforeAllFailed) fail('beforeAllFailed');
      const cumulusGranule = await granules.getGranule({
        prefix: stackName,
        granuleId: processGranule.granuleId,
      });
      expect(cumulusGranule.granuleId).toEqual(processGranule.granuleId);
      expect(cumulusGranule.collectionId).toEqual(constructCollectionId(targetCollection.name, targetCollection.version));
    });
  });
});
