import Knex from 'knex';

import { tableNames } from '../tables';

export interface arnRecord {
  arn: string;
}

export const getExecutionArnsByGranuleCumulusId = (
  knexOrTransaction: Knex | Knex.Transaction,
  granuleCumulusId: Number
): Promise<arnRecord[]> =>
  knexOrTransaction(tableNames.executions)
    .select('arn')
    .where(`${tableNames.granules}.cumulus_id`, granuleCumulusId)
    .join(
      tableNames.granulesExecutions,
      `${tableNames.executions}.cumulus_id`,
      `${tableNames.granulesExecutions}.execution_cumulus_id`
    )
    .join(
      tableNames.granules,
      `${tableNames.granules}.cumulus_id`,
      `${tableNames.granulesExecutions}.granule_cumulus_id`
    )
    .orderBy(`${tableNames.executions}.timestamp`, 'desc');
