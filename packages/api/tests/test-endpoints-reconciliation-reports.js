'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const reconciliationReportEndpoint = require('../endpoints/reconciliation-reports');
const { testEndpoint } = require('../lib/testUtils');

process.env.invoke = 'granule-reconciliation-reports';
process.env.stackName = 'test-stack';
process.env.system_bucket = 'test_system_bucket';

const reportNames = [randomString(), randomString()];
const reportDirectory = `${process.env.stackName}/reconciliation-reports`;

test.beforeEach(async () => {
  await aws.s3().createBucket({ Bucket: process.env.system_bucket }).promise();
  await Promise.all(reportNames.map((reportName) =>
    aws.s3().putObject({
      Bucket: process.env.system_bucket,
      Key: `${reportDirectory}/${reportName}`,
      Body: JSON.stringify({ test_key: `${reportName} test data` })
    }).promise()));
});

test.afterEach.always(async () => {
  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('default returns list of reports', (t) => {
  const event = { httpMethod: 'GET' };
  return testEndpoint(reconciliationReportEndpoint, event, (response) => {
    const results = JSON.parse(response.body);
    t.is(results.results.length, 2);
    results.results.forEach((reportName) => t.true(reportNames.includes(reportName)));
  });
});

test.serial('get a report', async (t) => {
  await Promise.all(reportNames.map((reportName) => {
    const event = {
      pathParameters: {
        name: reportName
      },
      httpMethod: 'GET'
    };

    return testEndpoint(reconciliationReportEndpoint, event, (response) => {
      t.deepEqual(JSON.parse(response.body), { test_key: `${reportName} test data` });
    });
  }));
});

test.serial('delete a report', async (t) => {
  await Promise.all(reportNames.map((reportName) => {
    const event = {
      pathParameters: {
        name: reportName
      },
      httpMethod: 'DELETE'
    };

    return testEndpoint(reconciliationReportEndpoint, event, (response) => {
      t.deepEqual(JSON.parse(response.body), { message: 'Report deleted' });
    });
  }));
});

test.serial('create a report', (t) => {
  const event = { httpMethod: 'POST' };
  return testEndpoint(reconciliationReportEndpoint, event, (response) => {
    const content = JSON.parse(response.body);
    t.is(content.message, 'Report is being generated');
  });
});
