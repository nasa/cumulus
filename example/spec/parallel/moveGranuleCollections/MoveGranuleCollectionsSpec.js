'use strict';

const { InvokeCommand } = require('@aws-sdk/client-lambda');
const { lambda } = require('@cumulus/aws-client/services');
const {
  deleteS3Object,
} = require('@cumulus/aws-client/S3');
const { loadConfig } = require('../../helpers/testUtils');
describe('when a bad record is ingested', () => {
  let stackName;
  let systemBucket;
  let leftoverS3Key;

  beforeAll(async () => {
    const config = await loadConfig();
    stackName = config.stackName;
    systemBucket = config.bucket;
  });
  afterAll(async () => {
    await deleteS3Object(
      systemBucket,
      leftoverS3Key
    );
  });
  describe('with full metadata present', () => {
    let beforeAllFailed;
    beforeAll(async () => {
      const { $metadata } = await lambda().send(new InvokeCommand({
        FunctionName: `${stackName}-MoveGranuleCollections`,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          config: {
            buckets: {
              internal: {
                type: "cumulus-test-sandbox-internal"
              },
              private: {
                name: "cumulus-test-sandbox-private",
                type: "private"
              },
              protected: {
                name: "cumulus-test-sandbox-protected",
                type: "protected"
              },
              public: {
                name: "cumulus-test-sandbox-public",
                type: "public"
              }
            },
            distribution_endpoint: "https://something.api.us-east-1.amazonaws.com/",
            collection: {
              files: [
                {
                  regex: "^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$",
                  sampleFileName: "MOD11A1.A2017200.h19v04.006.2017201090724.hdf",
                  bucket: "protected"
                },
                {
                  regex: "^BROWSE\\.MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$",
                  sampleFileName: "BROWSE.MOD11A1.A2017200.h19v04.006.2017201090724.hdf",
                  bucket: "private"
                },
                {
                  regex: "^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf\\.met$",
                  sampleFileName: "MOD11A1.A2017200.h19v04.006.2017201090724.hdf.met",
                  bucket: "private"
                },
                {
                  regex: "^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.cmr\\.xml$",
                  sampleFileName: "MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml",
                  bucket: "public"
                },
                {
                  regex: "^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$",
                  sampleFileName: "MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg",
                  bucket: "public"
                },
                {
                  regex: "^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$",
                  sampleFileName: "MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg",
                  bucket: "public",
                  url_path: "jpg/example2/"
                }
              ],
              url_path: "example2/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/",
              name: "MOD11A2",
              granuleIdExtraction: "(MOD11A1\\.(.*))\\.hdf",
              granuleId: "^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$",
              dataType: "MOD11A2",
              process: "modis",
              version: "006",
              sampleFileName: "MOD11A1.A2017200.h19v04.006.2017201090724.hdf",
              id: "MOD11A2"
            }
          },
          input: {
            granules: [
              {
                status: "completed",
                collectionId: "MOD11A1___006",
                granuleId: "MOD11A1.A2017200.h19v04.006.2017201090724",
                files: [
                  {
                    key: "file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf",
                    bucket: "protected4f58e06c55",
                    type: "data",
                    fileName: "MOD11A1.A2017200.h19v04.006.2017201090724.hdf"
                  },
                  {
                    key: "file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg",
                    bucket: "private94cf89afc4",
                    type: "browse",
                    fileName: "MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg"
                  },
                  {
                    key: "file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg",
                    bucket: "public6ab5e6ff51",
                    type: "browse",
                    fileName: "MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg"
                  },
                  {
                    key: "file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml",
                    bucket: "protected4f58e06c55",
                    type: "metadata",
                    fileName: "MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml"
                  }
                ]
              }
            ]
          }
        }),
      }));
      if ($metadata.httpStatusCode >= 400) {
        console.log(`lambda invocation to set up failed, code ${$metadata.httpStatusCode}`);
        beforeAllFailed = true;
        return;
      }
    });
    it('moves the granule data', async () => {
      if (beforeAllFailed) fail('beforeAllFailed');
    });
  });
});
