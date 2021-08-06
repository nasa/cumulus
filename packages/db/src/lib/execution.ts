import Knex from 'knex';

import { PostgresExecution } from '../types/execution';
import { tableNames } from '../tables';

export const getExecutionsByGranuleCumulusId = (
  knexOrTransaction: Knex | Knex.Transaction,
  granuleCumulusId: Number
): Promise<PostgresExecution> =>
  knexOrTransaction
    .select('*') // TODO should be executions.arn
    .from(tableNames.executions)
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
    .where(`${tableNames.granules}.cumulus_id`, granuleCumulusId)
    .orderBy(`${tableNames.executions}.timestamp`, 'desc');
