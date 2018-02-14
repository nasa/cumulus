const manager = require('../models/base');
const tableName = 'rule';

async function deleteRulesTable() {
  await manager.deleteTable(tableName);

deleteRulesTable();
