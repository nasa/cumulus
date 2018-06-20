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
      onlyInS3.push(nextS3Uri);
      s3ObjectsQueue.shift();
    }
    else if (nextS3Uri > nextDynamoDbUri) {
      const dynamoDbItem = await dynamoDbFilesLister.shift(); // eslint-disable-line no-await-in-loop, max-len
      onlyInDynamoDb.push({
        uri: buildS3Uri(Bucket, dynamoDbItem.key.S),
        granuleId: dynamoDbItem.granuleId.S
      });
    }
    else {
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

async function createReconciliationReport(params) {
  const {
    systemBucket,
    stackName,
    filesTableName
  } = params;

  // Fetch the bucket names to reconcile
  const bucketsConfigJson = await s3().getObject({
    Bucket: systemBucket,
    Key: `${stackName}/workflow/buckets.json`
  }).promise()
    .then((response) => response.Body.toString());
  const bucketsConfig = JSON.parse(bucketsConfigJson);
  const dataBuckets = Object.values(bucketsConfig).map((config) => config.name);

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

  // Upload initial report
  await s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report)
  }).promise();

  // Run the reports
  const promisedBucketReports = dataBuckets.map((bucket) =>
    createReconciliationReportForBucket(bucket, filesTableName));
  const bucketReports = await Promise.all(promisedBucketReports);

  // Store the report to S3

  report.reportEndTime = moment.utc().toISOString();
  report.status = 'SUCCESS';

  bucketReports.forEach((bucketReport) => {
    report.okFileCount += bucketReport.okFileCount;
    report.onlyInS3 = report.onlyInS3.concat(bucketReport.onlyInS3);
    report.onlyInDynamoDb = report.onlyInDynamoDb.concat(bucketReport.onlyInDynamoDb);
  });

  return s3().putObject({
    Bucket: systemBucket,
    Key: reportKey,
    Body: JSON.stringify(report)
  }).promise();
}

function handler(event, _context, cb) {
  // The event is used for tests
  // Environment variables are used when run in AWS
  return createReconciliationReport({
    systemBucket: event.systemBucket || process.env.systemBucket,
    stackName: event.stackName || process.env.stackName,
    filesTableName: event.filesTableName || process.env.filesTableName
  })
    .then(() => cb(null))
    .catch(cb);
}
exports.handler = handler;
