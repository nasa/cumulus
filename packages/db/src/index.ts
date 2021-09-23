import * as path from 'path';

export { default as Knex } from 'knex';
export {
  createTestDatabase,
  deleteTestDatabase,
  destroyLocalTestDb,
  fakeAsyncOperationRecordFactory,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  fakePdrRecordFactory,
  fakeProviderRecordFactory,
  fakeRuleRecordFactory,
  generateLocalTestDb,
} from './test-utils';

export { getKnexClient } from './connection';
export { getKnexConfig, localStackConnectionEnv } from './config';
export { tableNames } from './tables';
export const migrationDir = path.join(__dirname, 'migrations');

export {
  validateProviderHost,
  nullifyUndefinedProviderValues,
} from './provider';

export {
  PostgresAsyncOperation,
  PostgresAsyncOperationRecord,
} from './types/async_operation';
export {
  PostgresCollection,
  PostgresCollectionRecord,
} from './types/collection';
export {
  PostgresExecution,
  PostgresExecutionRecord,
} from './types/execution';
export {
  PostgresProvider,
  PostgresProviderRecord,
} from './types/provider';
export {
  PostgresRule,
  PostgresRuleRecord,
} from './types/rule';
export {
  PostgresGranule,
  PostgresGranuleRecord,
} from './types/granule';
export {
  PostgresPdr,
  PostgresPdrRecord,
} from './types/pdr';
export {
  PostgresFile,
  PostgresFileRecord,
} from './types/file';

export { translateApiAsyncOperationToPostgresAsyncOperation } from './translate/async_operations';
export {
  translateApiFiletoPostgresFile,
} from './translate/file';
export { translateApiCollectionToPostgresCollection } from './translate/collections';
export {
  translateApiProviderToPostgresProvider,
} from './translate/providers';
export { translateApiRuleToPostgresRule } from './translate/rules';
export {
  translateApiExecutionToPostgresExecution,
  translatePostgresExecutionToApiExecution,
} from './translate/executions';
export {
  translateApiGranuleToPostgresGranule,
  translatePostgresGranuleToApiGranule,
 } from './translate/granules';
export { translateApiPdrToPostgresPdr } from './translate/pdrs';

export {
  executionArnsFromGranuleIdsAndWorkflowNames,
  newestExecutionArnFromGranuleIdWorkflowName,
  getWorkflowNameIntersectFromGranuleIds,
  getApiExecutionCumulusIds,
  getApiGranuleExecutionCumulusIdsByExecution,
} from './lib/execution';

export {
  getApiGranuleCumulusIds,
  getApiGranuleExecutionCumulusIds,
  upsertGranuleWithExecutionJoinRecord,
} from './lib/granule';

export { AsyncOperationPgModel } from './models/async_operation';
export { BasePgModel } from './models/base';
export { CollectionPgModel } from './models/collection';
export { ExecutionPgModel } from './models/execution';
export { FilePgModel } from './models/file';
export { GranulePgModel } from './models/granule';
export { GranulesExecutionsPgModel } from './models/granules-executions';
export { PdrPgModel } from './models/pdr';
export { ProviderPgModel } from './models/provider';
export { RulePgModel } from './models/rule';
