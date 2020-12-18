import BasePgModel from './base';
import { tableNames } from '../tables';

import { PostgresFileRecord } from '../types';

export default class FilePgModel extends BasePgModel<PostgresFileRecord> {
  constructor() {
    super({
      tableName: tableNames.files,
    });
  }
}
