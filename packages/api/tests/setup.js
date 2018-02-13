const manager = require('../models/base');
const tableName = 'rule';

const ruleTableParams = {
  name: 'name',
  type: 'S',
  schema: 'HASH'
};

async function createRulesTable() {
  await manager.createTable(tableName, ruleTableParams);
}

createRulesTable();
