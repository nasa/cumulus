import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresAsyncOperation, PostgresAsyncOperationRecord } from '../types/async_operation';

// eslint-disable-next-line max-len
class AsyncOperationPgModel extends BasePgModel<PostgresAsyncOperation, PostgresAsyncOperationRecord> {
  constructor() {
    super({
      tableName: tableNames.asyncOperations,
    });
  }
}

export { AsyncOperationPgModel };
