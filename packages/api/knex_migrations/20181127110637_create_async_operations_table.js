'use strict';

const { DynamoDbScanQueue } = require('@cumulus/common/aws');

function dynamoDateToPgDate(dynamoDate) {
  return (new Date(Number(dynamoDate))).toISOString();
}

function dynamoRecordToPgRecord(dynamoRecord) {
  const pgRecord = { id: dynamoRecord.id.S };

  if (dynamoRecord.status) pgRecord.status = dynamoRecord.status.S;
  if (dynamoRecord.output) pgRecord.output = dynamoRecord.output.S;
  if (dynamoRecord.taskArn) pgRecord.task_arn = dynamoRecord.taskArn.S;

  if (dynamoRecord.createdAt) {
    pgRecord.created_at = dynamoDateToPgDate(dynamoRecord.createdAt.N);
  }

  if (dynamoRecord.updatedAt) {
    pgRecord.updated_at = dynamoDateToPgDate(dynamoRecord.updatedAt.N);
  }

  return pgRecord;
}

exports.up = async (knex) => {
  await knex.schema.createTable(
    'async_operations',
    (table) => {
      table.uuid('id').primary().notNull();
      table.timestamps(false, true);
      table.text('output').nullable();
      table.enu(
        'status',
        ['RUNNING', 'SUCCEEDED', 'RUNNER_FAILED', 'TASK_FAILED']
      ).notNull();
      table.string('task_arn').nullable();
    }
  );

  if (process.env.AsyncOperationsTable) {
    const dynamoDbScanQueue = new DynamoDbScanQueue({
      TableName: process.env.AsyncOperationsTable
    });

    const dynamoRecords = [];

    /* eslint-disable no-await-in-loop */
    while (await dynamoDbScanQueue.peek()) {
      dynamoRecords.push(await dynamoDbScanQueue.shift());
    }
    /* eslint-enable no-await-in-loop */

    const pgRecords = dynamoRecords.map(dynamoRecordToPgRecord);

    await knex('async_operations').insert(pgRecords);
  }
};

exports.down = (knex) => knex.schema.dropTable('async_operations');
