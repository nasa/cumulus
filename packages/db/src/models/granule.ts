import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresGranule, PostgresGranuleRecord } from '../types';

export default class GranulePgModel extends BasePgModel<PostgresGranule, PostgresGranuleRecord> {
  constructor() {
    super({
      tableName: tableNames.granules,
    });
  }
}

export { GranulePgModel };
