import { Knex } from 'knex';

import { BasePgModel } from './base';
import { TableNames } from '../tables';

import { convertIdFieldsToNumber } from '../lib/typeHelpers';
import { PostgresFile, PostgresFileRecord } from '../types/file';

class FilePgModel extends BasePgModel<PostgresFile, PostgresFileRecord> {
  constructor() {
    super({
      tableName: TableNames.files,
    });
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    file: PostgresFile
  ) {
    const record = await knexOrTrx(this.tableName)
      .insert(file)
      .onConflict(['bucket', 'key'])
      .merge()
      .returning('*');
    return convertIdFieldsToNumber(record);
  }
}

export { FilePgModel };
