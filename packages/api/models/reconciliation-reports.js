'use strict';

const Manager = require('./base');
const { reconciliationReport } = require('../lib/schemas');

class ReconciliationReport extends Manager {
  constructor() {
    super({
      schema: reconciliationReport,
    });
  }
}

module.exports = ReconciliationReport;
