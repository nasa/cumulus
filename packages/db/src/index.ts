import * as path from 'path';

export { Knex } from 'knex';
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

export { isCollisionError } from './lib/errors';
export { getKnexClient } from './connection';
export { getKnexConfig, localStackConnectionEnv } from './config';
export { createRejectableTransaction } from './database';
export { TableNames } from './tables';
export const migrationDir = path.join(__dirname, 'migrations');

export {
  validateProviderHost,
  nullifyUndefinedProviderValues,
} from './provider';

export {
  BaseRecord,
} from './types/base';
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
  PostgresFile,
  PostgresFileRecord,
} from './types/file';
export {
  PostgresGranule,
  PostgresGranuleRecord,
} from './types/granule';
export {
  PostgresGranuleExecution,
} from './types/granule-execution';
export {
  PostgresPdr,
  PostgresPdrRecord,
} from './types/pdr';
export {
  PostgresProvider,
  PostgresProviderRecord,
} from './types/provider';
export {
  PostgresReconciliationReport,
  PostgresReconciliationReportRecord,
} from './types/reconciliation_report';
export {
  PostgresRule,
  PostgresRuleRecord,
} from './types/rule';

export {
  translateApiAsyncOperationToPostgresAsyncOperation,
  translatePostgresAsyncOperationToApiAsyncOperation,
} from './translate/async_operations';
export {
  translateApiCollectionToPostgresCollection,
  translatePostgresCollectionToApiCollection,
} from './translate/collections';
export {
  translateApiExecutionToPostgresExecution,
  translateApiExecutionToPostgresExecutionWithoutNilsRemoved,
  translatePostgresExecutionToApiExecution,
} from './translate/executions';
export {
  translateApiFiletoPostgresFile,
  translatePostgresFileToApiFile,
} from './translate/file';
export {
  translateApiGranuleToPostgresGranule,
  translateApiGranuleToPostgresGranuleWithoutNilsRemoved,
  translatePostgresGranuleToApiGranule,
  translatePostgresGranuleResultToApiGranule,
} from './translate/granules';
export {
  translateApiPdrToPostgresPdr,
  translatePostgresPdrToApiPdr,
} from './translate/pdr';
export {
  translateApiProviderToPostgresProvider,
  translatePostgresProviderToApiProvider,
} from './translate/providers';
export {
  translatePostgresRuleToApiRule,
  translateApiRuleToPostgresRule,
  translateApiRuleToPostgresRuleRaw,
} from './translate/rules';

export {
  getCollectionsByGranuleIds,
} from './lib/collection';

export {
  batchDeleteExecutionFromDatabaseByCumulusCollectionId,
  executionArnsFromGranuleIdsAndWorkflowNames,
  getApiExecutionCumulusIds,
  getApiGranuleExecutionCumulusIdsByExecution,
  getExecutionInfoByGranuleCumulusId,
  getWorkflowNameIntersectFromGranuleIds,
  newestExecutionArnFromGranuleIdWorkflowName,
} from './lib/execution';

export {
  getFilesAndGranuleInfoQuery,
} from './lib/file';

export {
  getApiGranuleCumulusIds,
  getApiGranuleExecutionCumulusIds,
  getGranuleCollectionId,
  getUniqueGranuleByGranuleId,
  getGranuleByUniqueColumns,
  upsertGranuleWithExecutionJoinRecord,
  getGranulesByApiPropertiesQuery,
  getGranulesByGranuleId,
  getGranuleAndCollection,
} from './lib/granule';

export {
  QuerySearchClient,
} from './lib/QuerySearchClient';
export {
  AsyncOperationSearch,
} from './search/AsyncOperationSearch';
export {
  CollectionSearch,
} from './search/CollectionSearch';
export {
  ExecutionSearch,
} from './search/ExecutionSearch';
export {
  GranuleSearch,
} from './search/GranuleSearch';
export {
  ProviderSearch,
} from './search/ProviderSearch';
export {
  StatsSearch,
} from './search/StatsSearch';

export { BasePgModel } from './models/base';
export { AsyncOperationPgModel } from './models/async_operation';
export { CollectionPgModel } from './models/collection';
export { ExecutionPgModel } from './models/execution';
export { FilePgModel } from './models/file';
export { GranulePgModel } from './models/granule';
export { GranulesExecutionsPgModel } from './models/granules-executions';
export { PdrPgModel } from './models/pdr';
export { ProviderPgModel } from './models/provider';
export { ReconciliationReportPgModel } from './models/reconciliation_report'
export { RulePgModel } from './models/rule';
