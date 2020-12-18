import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresFile, PostgresFileRecord } from '../types';

class FilePgModel extends BasePgModel<PostgresFile, PostgresFileRecord> {
  constructor() {
    super({
      tableName: tableNames.files,
    });
  }
}

export { FilePgModel };
