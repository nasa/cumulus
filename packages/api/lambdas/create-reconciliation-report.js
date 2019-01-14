'use strict';

const moment = require('moment');
const {
  aws: {
    buildS3Uri,
    DynamoDbScanQueue,
    S3ListObjectsV2Queue,
    s3
  }
} = require('@cumulus/common');

/**
 * Verify that all objects in an S3 bucket contain corresponding entries in
 * DynamoDB, and that there are no extras in either S3 or DynamoDB
 *
 * @param {string} Bucket - the bucket containing files to be reconciled
 * @param {string} filesTableName - the name of the files table in DynamoDB
 * @returns {Promise<Object>} a report
 */
async function createReconciliationReportForBucket(Bucket, filesTableName) {
  const s3ObjectsQueue = new S3ListObjectsV2Queue({ Bucket });
  const dynamoDbFilesLister = new DynamoDbScanQueue({
    TableName: filesTableName,
    ExpressionAttributeNames: { '#b': 'bucket' },
    ExpressionAttributeValues: { ':bucket': { S: Bucket } },
    FilterExpression: '#b = :bucket'
  });

  let okFileCount = 0;
  const onlyInS3 = [];
  const onlyInDynamoDb = [];

  let [nextS3Object, nextDynamoDbItem] = await Promise.all([s3ObjectsQueue.peek(), dynamoDbFilesLister.peek()]); // eslint-disable-line max-len
  while (nextS3Object && nextDynamoDbItem) {
    const nextS3Uri = buildS3Uri(Bucket, nextS3Object.Key);
    const nextDynamoDbUri = buildS3Uri(Bucket, nextDynamoDbItem.key.S);

    if (nextS3Uri < nextDynamoDbUri) {
      // Found an item that is only in S3 and not in DynamoDB
      onlyInS3.push(nextS3Uri);
      s3ObjectsQueue.shift();
    }
    else if (nextS3Uri > nextDynamoDbUri) {
      // Found an item that is only in DynamoDB and not in S3
      const dynamoDbItem = await dynamoDbFilesLister.shift(); // eslint-disable-line no-await-in-loop, max-len
      onlyInDynamoDb.push({
        uri: buildS3Uri(Bucket, dynamoDbItem.key.S),
        granuleId: dynamoDbItem.granuleId.S
      });
    }
    else {
      // Found an item that is in both S3 and DynamoDB
      okFileCount += 1;
      s3ObjectsQueue.shift();
      dynamoDbFilesLister.shift();
    }

    [nextS3Object, nextDynamoDbItem] = await Promise.all([s3ObjectsQueue.peek(), dynamoDbFilesLister.peek()]); // eslint-disable-line max-len, no-await-in-loop
  }

  // Add any remaining S3 items to the report
  while (await s3ObjectsQueue.peek()) { // eslint-disable-line no-await-in-loop
    const s3Object = await s3ObjectsQueue.shift(); // eslint-disable-line no-await-in-loop
    onlyInS3.push(buildS3Uri(Bucket, s3Object.Key));
  }

  // Add any remaining DynamoDB items to the report
  while (await dynamoDbFilesLister.peek()) { // eslint-disable-line no-await-in-loop
    const dynamoDbItem = await dynamoDbFilesLister.shift(); // eslint-disable-line no-await-in-loop
    onlyInDynamoDb.push({
      uri: buildS3Uri(Bucket, dynamoDbItem.key.S),
      granuleId: dynamoDbItem.granuleId.S
    });
  }

  return {
    okFileCount,
    onlyInS3,
    onlyInDynamoDb
  };
}

/**
 * Create a Reconciliation report and save it to S3
 *
 * @param {Object} params - params
 * @param {string} params.systemBucket - the name of the CUMULUS system bucket
 * @param {string} params.stackName - the name of the CUMULUS stack
 * @param {string} params.filesTableName - the name of the files table in
 *   DynamoDB
 * @returns {Promise<null>} a Promise that resolves when the report has been
 *   uploaded to S3
 */
async function createReconciliationReport(params) {
  const {
    systemBucket,
    stackName,
    filesTableName
  } = params;

  // Fetch the bucket names to reconcile
  const bucketsConfigJson = await s3().getObject({
    Bucket: systemBucket,
    Key: `${stackName}/workflows/buckets.json`
  }).promise()
    .then((response) => response.Body.toString());
  const dataBuckets = Object.values(JSON.parse(bucketsConfigJson))
    .filter((config) => config.name !== systemBucket)
    .map((config) => config.name);

  // Write an initial report to S3
  const report = {
    reportStartTime: moment.utc().toISOString(),
    reportEndTime: null,
    status: 'RUNNING',
    error: null,
    okFileCount: 0,
    onlyInS3: [],
    onlyInDynamoDb: []
  };

  const reportKey = `${stackName}/reconciliation-reports/report-${report.reportStartTime}.json`;

  await s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report)
  }).promise();

  // Create a report for each bucket
  const promisedBucketReports = dataBuckets.map((bucket) =>
    createReconciliationReportForBucket(bucket, filesTableName));
  const bucketReports = await Promise.all(promisedBucketReports);

  // Create the full report
  report.reportEndTime = moment.utc().toISOString();
  report.status = 'SUCCESS';

  bucketReports.forEach((bucketReport) => {
    report.okFileCount += bucketReport.okFileCount;
    report.onlyInS3 = report.onlyInS3.concat(bucketReport.onlyInS3);
    report.onlyInDynamoDb = report.onlyInDynamoDb.concat(bucketReport.onlyInDynamoDb);
  });

  // Write the full report to S3
  return s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report)
  }).promise()
    .then(() => null);
}

function handler(event, _context, cb) {
  // The event is used for tests
  // Environment variables are used when run in AWS
  return createReconciliationReport({
    systemBucket: event.systemBucket || process.env.system_bucket,
    stackName: event.stackName || process.env.stackName,
    filesTableName: event.filesTableName || process.env.filesTableName
  })
    .then(() => cb(null))
    .catch(cb);
}
exports.handler = handler;
