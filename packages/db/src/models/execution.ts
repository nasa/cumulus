import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresExecution, PostgresExecutionRecord } from '../types';

class ExecutionPgModel extends BasePgModel<PostgresExecution, PostgresExecutionRecord> {
  constructor() {
    super({
      tableName: tableNames.executions,
    });
  }
}

export { ExecutionPgModel };
