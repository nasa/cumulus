import Knex from 'knex';



export const executionArnsFromGranuleIdsAndWorkflowNames = async (
    knex: Knex,
    granuleIds: string[],
    workflowNames: string[]
): Promise<string[]> => {
    return knex.select('executions.arn').from('executions')
	.join('granules_executions', 'executions.cumulus_id', 'granules_executions.execution_cumulus_id')
	.join('granules', 'granules.cumulus_id', 'granules_executions.granule_cumulus_id')
	.whereIn('granules.granule_id', granuleIds)
	.whereIn('executions.workflow_name', workflowNames)
	.orderBy('executions.timestamp', 'desc')
};

// knex.select(['executions.arn', 'executions.timestamp', 'executions.workflow_name']).from('executions')
// .join('granules_executions', 'executions.cumulus_id', 'granules_executions.execution_cumulus_id')
// .join('granules', 'granules.cumulus_id', 'granules_executions.granule_cumulus_id')
// .whereIn('granules.granule_id', ['YUM88OK.A2016358.h13v04.006.2016360104606'])
// .whereIn('executions.workflow_name', ['IngestGranule', 'DiscoverGranules'])
// .orderBy('executions.timestamp', 'desc')
