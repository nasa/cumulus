import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresProvider, PostgresProviderRecord } from '../types/provider';

class ProviderPgModel extends BasePgModel<PostgresProvider, PostgresProviderRecord> {
  constructor() {
    super({
      tableName: tableNames.providers,
    });
  }
}

export { ProviderPgModel };
