const moment = require('moment');
const { s3 } = require('@cumulus/aws-client/services');
const { buildS3Uri, parseS3Uri } = require('@cumulus/aws-client/S3');
const { ReconciliationReport } = require('../models');

const reportsPrefix = (stackName) => `${stackName}/reconciliation-reports/`;

function getS3ReportsKeys(systemBucket, stackName) {
  return s3().listObjectsV2({
    Bucket: systemBucket,
    Prefix: reportsPrefix(stackName),
  }).promise()
    .then((response) => response.Contents.map((o) => o.Key));
}

// get list of reconciliation reports in s3 and add them to the new database table
async function run(_options) {
  const reconciliationReportModel = new ReconciliationReport();
  const response = await reconciliationReportModel.scan();
  const s3filesInDb = response.Items.map((item) => item.location);

  const systemBucket = process.env.system_bucket;
  const reportKeys = await getS3ReportsKeys(systemBucket, process.env.stackName);
  const s3filesNotInDb = reportKeys.map((key) => buildS3Uri(systemBucket, key))
    .filter((item) => !s3filesInDb.includes(item));

  const reportToRecordStatus = {
    SUCCESS: 'Generated',
    RUNNING: 'Pending',
  };

  const addedItems = await Promise.all(s3filesNotInDb.map(async (s3Report) => {
    const s3Response = await s3().getObject(parseS3Uri(s3Report)).promise();
    const report = JSON.parse(s3Response.Body.toString());
    const reportRecord = {
      name: `inventoryReport-${moment.utc(report.reportStartTime).format('YYYYMMDDTHHmmssSSS')}`,
      type: 'Inventory',
      status: reportToRecordStatus[report.status] || 'Failed',
      location: s3Report,
      createdAt: moment.utc(report.reportStartTime).toDate().getTime(),
    };
    return reportRecord;
  }));

  return reconciliationReportModel.create(addedItems);
}

module.exports.name = 'migration_5';
module.exports.run = run;
