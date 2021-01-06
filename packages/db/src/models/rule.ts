import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresRule, PostgresRuleRecord } from '../types/rule';

class RulePgModel extends BasePgModel<PostgresRule, PostgresRuleRecord> {
  constructor() {
    super({
      tableName: tableNames.rules,
    });
  }
}

export { RulePgModel };
