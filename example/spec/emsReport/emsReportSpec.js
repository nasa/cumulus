const moment = require('moment');
const { Lambda } = require('aws-sdk');
const aws = require('@cumulus/common/aws');
const AWS = require('aws-sdk');
const { loadConfig } = require('../helpers/testUtils');


const config = loadConfig();

const emsReportLambda = `${config.prefix}-EmsReport`;
const bucket = config.bucket;
const emsProvider = config.ems_provider;
const stackName = config.stackName;

describe('The EMS report', () => {
  describe('When run automatically', () => {
    let expectReports = false;
    beforeAll(async () => {
      const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
      AWS.config.update({ region: region });

      const lambda = new Lambda();
      const lambdaConfig = await lambda.getFunctionConfiguration({ FunctionName: emsReportLambda })
        .promise();
      const lastUpdate = lambdaConfig.LastModified;

      // Compare lambda function's lastUpdate with the time 24 hours before now.
      // If the lambda is created 24 hours ago, it must have been invoked
      // and generated EMS reports for the previous day.
      if (new Date(lastUpdate).getTime() < moment.utc().subtract(24, 'hours').toDate().getTime()) {
        expectReports = true;
      }
    });

    it('generates an EMS report every 24 hours', async () => {
      if (expectReports) {
        const datestring = moment.utc().format('YYYYMMDD');
        const types = ['Ing', 'Arch', 'ArchDel'];
        const jobs = types.map((type) => {
          const filename = `${datestring}_${emsProvider}_${type}_${stackName}.flt`;
          const key = `${stackName}/ems/${filename}`;
          return aws.fileExists(bucket, key);
        });
        const results = await Promise.all(jobs);
        results.forEach((result) => expect(result).not.toBe('false'));
      }
    });
  });

  describe('After execution', () => {
    let lambdaOutput;
    beforeAll(async () => {
      const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
      AWS.config.update({ region: region });
      const lambda = new Lambda();
      const response = await lambda.invoke({ FunctionName: emsReportLambda }).promise()
        .catch((err) => console.log('invoke err', err));
      lambdaOutput = JSON.parse(response.Payload);
    });

    afterAll(async () => {
      const jobs = lambdaOutput.map(async (report) => {
        const parsed = aws.parseS3Uri(report.file);
        return aws.s3().deleteObject({ Bucket: parsed.Bucket, Key: parsed.Key }).promise();
      });
      await Promise.all(jobs);
    });

    it('generates an EMS report', async () => {
      const jobs = lambdaOutput.map(async (report) => {
        const parsed = aws.parseS3Uri(report.file);
        return aws.fileExists(parsed.Bucket, parsed.Key);
      });
      const results = await Promise.all(jobs);
      results.forEach((result) => expect(result).not.toBe('false'));
    });
  });
});
