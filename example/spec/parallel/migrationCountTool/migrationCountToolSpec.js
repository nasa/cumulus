'use strict';

const { isNumber } = require('lodash');
const { getJsonS3Object, parseS3Uri } = require('@cumulus/aws-client/S3');
const { postMigrationCounts } = require('@cumulus/api-client/migrationCounts');
const { waitForAsyncOperationStatus } = require('@cumulus/integration-tests');
const cryptoRandomString = require('crypto-random-string');
const {
  loadConfig,
} = require('../../helpers/testUtils');

describe('The AsyncOperation task runner executing a successful lambda function', () => {
  let asyncOperation;
  let beforeAllFailed = false;
  let config;
  let s3ReportObject;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      const reportPath = `${config.stackName}/migrationCounts/${cryptoRandomString({ length: 10 })}-report.json`;
      const reportBucket = config.buckets.internal.name;
      const payload = {
        reportBucket,
        reportPath,
      };

      const response = await postMigrationCounts({
        prefix: config.stackName,
        payload,
      });

      asyncOperation = await waitForAsyncOperationStatus({
        id: JSON.parse(response.body).id,
        status: 'SUCCEEDED',
        stackName: config.stackName,
        retries: 120,
      });

      const asyncOutput = JSON.parse(asyncOperation.output);
      const parsedUri = parseS3Uri(asyncOutput.s3Uri);
      s3ReportObject = await getJsonS3Object(parsedUri.Bucket, parsedUri.Key );
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  it('updates the status field to "SUCCEEDED"', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else expect(asyncOperation.status).toEqual('SUCCEEDED');
  });

  it('posts a parsable report to s3', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      const parsedOutput = JSON.parse(asyncOperation.output);
      expect(
        Object.keys(parsedOutput)
      ).toEqual([
        'collectionsNotMapped',
        'records_in_dynamo_not_in_postgres',
        'pdr_granule_and_execution_records_not_in_postgres_by_collection',
        's3Uri',
      ]);
      expect(
        Object.keys(parsedOutput.records_in_dynamo_not_in_postgres).forEach((k) => {
          if (!isNumber(parsedOutput.records_in_dynamo_not_in_postgres[k])) {
            throw new Error('boom');
          }
        })
      ).not.toThrow();
      expect(s3ReportObject).toEqual(parsedOutput);
    }
  });
});
