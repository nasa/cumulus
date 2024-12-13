'use strict';

const { InvokeCommand } = require('@aws-sdk/client-lambda');
const { lambda } = require('@cumulus/aws-client/services');
const {
  promiseS3Upload,
} = require('@cumulus/aws-client/S3');
const { waitForListObjectsV2ResultCount } = require('@cumulus/integration-tests');

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { loadConfig } = require('../../helpers/testUtils');
describe('when moveGranulesCollection is called', () => {
  let stackName;

  beforeAll(async () => {
    const config = await loadConfig();
    stackName = config.stackName;
    // systemBucket = config.bucket;
  });
  // afterAll(async () => {
  //   await deleteS3Object(
  //     systemBucket,
  //     leftoverS3Key
  //   );
  // });
  describe('under normal circumstances', () => {
    let beforeAllFailed;
    beforeAll(async () => {
      const sourceUrlPrefix = `source_path/${uuidv4()}`;
      const targetUrlPrefix = `target_path/${uuidv4()}`;
      const payload = {
        meta: {
          collection: {
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
            url_path: targetUrlPrefix,
            name: 'MOD11A2',
            granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
            granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
            dataType: 'MOD11A2',
            process: 'modis',
            version: '006',
            sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
            id: 'MOD11A2',
          },
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
          buckets: "{$.meta.buckets}",
          distribution_endpoint: 'https://something.api.us-east-1.amazonaws.com/',
          collection: "{$.meta.collection}",
        },
        input: {
          granules: [
            {
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
            },
          ],
        },
      };
      // const cmaObject = {cma: { event: { payload }}}
      await Promise.all(payload.input.granules[0].files.map(async (file) => {
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
        FunctionName: `ecarton-ci-tf-MoveGranuleCollections`,
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
      const expectedFiles = [
        {
          bucket: 'cumulus-test-sandbox-protected',
          prefix: `${targetUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.hdf`,
        },
        {
          bucket: 'cumulus-test-sandbox-public',
          prefix: `${targetUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
        },
        {
          bucket: 'cumulus-test-sandbox-public',
          prefix: `${targetUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
        },
        {
          bucket: 'cumulus-test-sandbox-public',
          prefix: `${targetUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`,
        },
      ];
      // try {
      await Promise.all(expectedFiles.map((file) => expectAsync(
        waitForListObjectsV2ResultCount({
          ...file,
          desiredCount: 1,
          interval: 5 * 1000,
          timeout: 30 * 1000,
        })
      ).toBeResolved()));
      // } catch (error) {
      //   console.log(`files do not appear to have been moved: error: ${error}`);
      // }
    });
    it('moves the granule data', () => {
      if (beforeAllFailed) fail('beforeAllFailed');
    });
  });
});
