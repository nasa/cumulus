const aws = require('aws-sdk');
const snakeCase = require('lodash.snakeCase');
const mapKeys = require('lodash.mapkeys');
const mapValues = require('lodash.mapvalues');
const { DynamoDbScanQueue } = require('@cumulus/common/aws');

exports.up = async function(knex) {

  await knex.schema.createTable(
    'executions',
    (table) => {
      table.bigIncrements('id').primary(),
      table.string('arn').unique().notNull(),
      table.string('parent_arn');
      table.float('duration');
      table.string('name');
      table.string('execution');
      table.json('error');
      table.json('tasks');
      table.string('collection_id');
      table.string('type'); // TODO: should this be enum?
      table.enu('status', ['running', 'completed', 'failed' ,'unknown']);
      table.bigInteger('created_at').defaultTo(Date.now());
      table.bigInteger('updated_at').defaultTo(Date.now());
      table.bigInteger('timestamp').defaultTo(Date.now());
      table.json('original_payload');
      table.json('final_payload');
    });
  try {
    if (process.env.ExecutionsTable) {
      //  if (false) {
      const dynamoDbScanQueue = new DynamoDbScanQueue({
        TableName: process.env.ExecutionsTable
      });
      const dynamoRecords = [];

      /* eslint-disable no-await-in-loop */
      while (await dynamoDbScanQueue.peek()) {
        dynamoRecords.push(await dynamoDbScanQueue.shift());
      }

      let pgRecords = [];
      dynamoRecords.forEach((dynamoRecord) => {
        let updateRecord;
        updateRecord = mapKeys(dynamoRecord, (_value, key) => snakeCase(key));
        updateRecord = aws.DynamoDB.Converter.unmarshall(updateRecord);
        ['error', 'tasks', 'original_payload', 'final_payload'].forEach((key) => {
          updateRecord[key] = JSON.stringify(updateRecord[key]);
        });
        ['created_at', 'updated_at', 'timestamp'].forEach((key) => {
          if (updateRecord[key]) {
            updateRecord[key] = parseInt(updateRecord[key]);
          }
        });
        pgRecords.push(updateRecord);
      });
      let foo = knex.fn.now();
      await knex('executions').insert(pgRecords);
    }
  }
  catch (e) {
    await knex.schema.dropTable('executions');
    throw e;
  }
};

exports.down = (knex) => knex.schema.dropTable('executions');
