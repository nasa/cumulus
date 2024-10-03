'use strict';

const Manager = require('./base');
const { reconciliationReport } = require('../lib/schemas');

class ReconciliationReport extends Manager {
  constructor() {
    super({
      tableName: process.env.ReconciliationReportsTable,
      tableHash: { name: 'name', type: 'S' },
      schema: reconciliationReport,
    });
  }
}

module.exports = ReconciliationReport;
