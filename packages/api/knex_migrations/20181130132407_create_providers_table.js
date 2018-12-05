'use strict';

const { DynamoDbScanQueue } = require('@cumulus/common/aws');

function providersModelCallback(table) {
  table.string('id').primary().notNull();
  table.timestamps(false, true);
  table.integer('global_connection_limit').notNull();
  table.text('host').notNull();
  table.enu(
    'protocol',
    ['http', 'https', 'ftp', 'sftp', 's3']
  ).notNull();
  table.integer('port');
  table.string('username', 1000);
  table.string('password', 1000);
  table.string('encrypted');
  table.json('meta');
};


function dynamoRecordToPgRecord(dynamoRecord) {
  const fields = ['id', 'port', 'host', 'username', 'password', 'encrypted', 'protocol', 'globalConnectionLimit'];
  const pgRecord = {};
  fields.map((field) => {
    if ( dynamoRecord[field] ) {
      const updateField = field.replace(/([A-Z])/g, (v) => '_' + v.toLowerCase()).replace(/^_/, '');
      pgRecord[updateField] = dynamoRecord[field][Object.keys(dynamoRecord[field])[0]];
    }
  });
  return pgRecord;
}

exports.up = async (knex) => {
  await knex.schema.createTable('providers', providersModelCallback);

  if (process.env.ProvidersTable) {
    const dynamoDbScanQueue = new DynamoDbScanQueue({
      TableName: process.env.ProvidersTable
    });
    const dynamoRecords = [];

    /* eslint-disable no-await-in-loop */
    while (await dynamoDbScanQueue.peek()) {
      dynamoRecords.push(await dynamoDbScanQueue.shift());
    }
    /* eslint-enable no-await-in-loop */
    const pgRecords = dynamoRecords.map(dynamoRecordToPgRecord);
    debugger;
    await knex('providers').insert(pgRecords);
  }
};

exports.down = (knex) => knex.schema.dropTable('providers');
