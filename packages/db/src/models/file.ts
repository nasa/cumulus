import { Knex } from 'knex';

import { BasePgModel } from './base';
import { TableNames } from '../tables';

import { convertRecordsIdFieldsToNumber } from '../lib/typeHelpers';
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
    const records = await knexOrTrx(this.tableName)
      .insert(file)
      .onConflict(['bucket', 'key'])
      .merge()
      .returning('*');
    return convertRecordsIdFieldsToNumber(records) as PostgresFileRecord[];
  }
}

export { FilePgModel };
