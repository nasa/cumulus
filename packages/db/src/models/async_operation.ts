import Knex from 'knex';

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

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    asyncOperation: PostgresAsyncOperation
  ) {
    return knexOrTrx(this.tableName)
      .insert(asyncOperation)
      .onConflict('id')
      .merge()
      .returning('cumulus_id');
  }
}

export { AsyncOperationPgModel };
