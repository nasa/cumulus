const moment = require('moment');
const AWS = require('aws-sdk');

const {
  aws: {
    fileExists,
    getS3Object,
    parseS3Uri,
    lambda
  }
} = require('@cumulus/common');
const {
  addCollections,
  cleanupCollections
} = require('@cumulus/integration-tests');

const { loadConfig } = require('../../helpers/testUtils');

const config = loadConfig();
const emsProductMetadataReportLambda = `${config.stackName}-EmsProductMetadataReport`;
const submitReport = config.ems.submitReport === 'true' || false;
const collectionsDir = './data/collections/ems';

// sample collections in CMR and Cumulus for verification purpose
// collections only in Cumulus
const collectionsOnlyInCumulus = ['MYDTEST'];

// collections only in CMR
const collectionsOnlyInCmr = ['AST_L1A'];

// collections in both CMR and Cumulus, they should be exported to EMS
const collectionsForEms = ['A2_SI25_NRT', 'MUR-JPL-L4-GLOB-v4.1'];

describe('The EMS product metadata report', () => {
  beforeAll(async () => {
    await addCollections(config.stackName, config.bucket, collectionsDir);
  });

  afterAll(async () => {
    await cleanupCollections(config.stackName, config.bucket, collectionsDir);
  });

  describe('After execution of EmsProductMetadataReport lambda', () => {
    let lambdaOutput;
    beforeAll(async () => {
      const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
      AWS.config.update({ region: region });

      const endTime = moment.utc().add(1, 'days').startOf('day').format();
      const startTime = moment.utc().startOf('day').format();

      const response = await lambda().invoke({
        FunctionName: emsProductMetadataReportLambda,
        Payload: JSON.stringify({
          startTime,
          endTime
        })
      }).promise()
        .catch((err) => console.log('invoke err', err));

      lambdaOutput = JSON.parse(response.Payload);
    });

    it('generates an EMS product metadata report', async () => {
      expect(lambdaOutput.length).toEqual(1);
      const report = lambdaOutput[0];
      const parsed = parseS3Uri(report.file);
      expect(await fileExists(parsed.Bucket, parsed.Key)).not.toBe(false);
      const obj = await getS3Object(parsed.Bucket, parsed.Key);
      const reportRecords = obj.Body.toString().split('\n');

      // only collections in both CMR and Collections are included in report
      const records = reportRecords.filter((record) =>
        collectionsForEms.includes(record.split('|&|')[0]));
      expect(records.length).toEqual(collectionsForEms.length);

      const cumulusOnlyRecords = reportRecords.filter((record) =>
        collectionsOnlyInCumulus.includes(record.split('|&|')[0]));
      expect(cumulusOnlyRecords.length).toEqual(0);

      const cmrOnlyRecords = reportRecords.filter((record) =>
        collectionsOnlyInCmr.includes(record.split('|&|')[0]));
      expect(cmrOnlyRecords.length).toEqual(0);

      if (submitReport) {
        expect(parsed.Key.includes('/sent/')).toBe(true);
      }
    });
  });
});
