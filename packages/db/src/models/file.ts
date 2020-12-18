import Knex from 'knex';

import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresFile, PostgresFileRecord } from '../types/file';

class FilePgModel extends BasePgModel<PostgresFileRecord> {
  constructor() {
    super({
      tableName: tableNames.files,
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
}

export { FilePgModel };
