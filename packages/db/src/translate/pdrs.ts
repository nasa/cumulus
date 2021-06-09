import Knex from 'knex';

import { ApiPdr } from '@cumulus/types/api/pdrs';

import { CollectionPgModel } from '../models/collection';
import { ExecutionPgModel } from '../models/execution';
import { ProviderPgModel } from '../models/provider';
import { PostgresPdr } from '../types/pdr';

export const translatePostgresPdrToApiPdr = async (
  postgresPDR: PostgresPdr,
  knex: Knex | Knex.Transaction,
  collectionPgModel = new CollectionPgModel(),
  executionPgModel = new ExecutionPgModel(),
  providerPgModel = new ProviderPgModel()
): Promise<ApiPdr> => {
  const collection = await collectionPgModel.get(knex, {
    cumulus_id: postgresPDR.collection_cumulus_id,
  });
  const execution = await executionPgModel.get(knex, {
    cumulus_id: postgresPDR.execution_cumulus_id,
  });
  const provider = await providerPgModel.get(knex, {
    cumulus_id: postgresPDR.provider_cumulus_id,
  });

  return {
    pdrName: postgresPDR.name,
    provider: provider.name,
    collectionId: `${collection.name}___${collection.version}`,
    status: postgresPDR.status,
    createdAt: (postgresPDR.created_at ? postgresPDR.created_at.getTime() : undefined),
    progress: postgresPDR.progress,
    execution: execution.arn,
    PANSent: postgresPDR.pan_sent,
    PANmessage: postgresPDR.pan_message,
    stats: postgresPDR.stats,
    address: postgresPDR.address,
    originalUrl: postgresPDR.original_url,
    timestamp: (postgresPDR.timestamp ? postgresPDR.timestamp.getTime() : undefined),
    duration: postgresPDR.duration,
    updatedAt: (postgresPDR.updated_at ? postgresPDR.updated_at.getTime() : undefined),
  };
};
