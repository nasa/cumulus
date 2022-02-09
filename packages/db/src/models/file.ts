import { Knex } from 'knex';

import { BasePgModel } from './base';
import { TableNames } from '../tables';

import { PostgresFile, PostgresFileRecord } from '../types/file';

class FilePgModel extends BasePgModel<PostgresFile, PostgresFileRecord> {
  constructor() {
    super({
      tableName: TableNames.files,
    });
  }

  upsert(
    knexOrTrx: Knex | Knex.Transaction,
    file: PostgresFile
  ) {
    return knexOrTrx(this.tableName)
      .insert(file)
      .onConflict(['bucket', 'key'])
      .merge();
  }

  async search(
    knexOrTransaction: Knex | Knex.Transaction,
    params: Partial<PostgresFileRecord>
  ): Promise<PostgresFileRecord[]> {
    return super.search(knexOrTransaction, params, ['bucket', 'key']);
  }
}

export { FilePgModel };
