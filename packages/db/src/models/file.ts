import { Knex } from 'knex';

import { BasePgModel } from './base';
import { TableNames } from '../tables';

import { PostgresFile, PostgresFileRecord, PostgresReturnFileRecord } from '../types/file';

class FilePgModel extends BasePgModel<PostgresFile, PostgresFileRecord> {
  constructor() {
    super({
      tableName: TableNames.files,
      convertRecordFunction: (record: PostgresReturnFileRecord) => {
        if (record.file_size) {
          return { ...record, file_size: BigInt(record.file_size) } as PostgresFileRecord;
        }
        return record as PostgresFileRecord;
      },
    });
  }

  _convert(record: PostgresReturnFileRecord): PostgresFileRecord {
    if (record.file_size) {
      return { ...record, file_size: BigInt(record.file_size) } as PostgresFileRecord;
    }
    return record as PostgresFileRecord;
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
