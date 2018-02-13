const manager = require('../models/base');
const tableName = 'rule';
process.env.RulesTable = tableName;

const ruleTableParams = {
  name: 'name',
  type: 'S',
  schema: 'HASH'
};

async function createRulesTable() {
  await manager.createTable(tableName, ruleTableParams);
}

createRulesTable();
