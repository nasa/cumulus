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
  fakeGranuleGroupRecordFactory,
  fakePdrRecordFactory,
  fakeProviderRecordFactory,
  fakeReconciliationReportRecordFactory,
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
  PostgresGranuleGroup,
  PostgresGranuleGroupRecord,
} from './types/granule-group';
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
export {
  PostgresGranuleExecution,
} from './types/granule-execution';
export {
  PostgresReconciliationReport,
  PostgresReconciliationReportRecord,
} from './types/reconciliation_report';

export {
  translateApiAsyncOperationToPostgresAsyncOperation,
  translatePostgresAsyncOperationToApiAsyncOperation,
} from './translate/async_operations';
export {
  translateApiFiletoPostgresFile,
  translatePostgresFileToApiFile,
} from './translate/file';
export {
  translateApiCollectionToPostgresCollection,
  translatePostgresCollectionToApiCollection,
} from './translate/collections';
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
  translateApiExecutionToPostgresExecution,
  translateApiExecutionToPostgresExecutionWithoutNilsRemoved,
  translatePostgresExecutionToApiExecution,
} from './translate/executions';
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
  translateApiReconReportToPostgresReconReport,
  translatePostgresReconReportToApiReconReport,
} from './translate/reconciliation_reports';

export {
  getCollectionsByGranuleIds,
  getUniqueCollectionsByGranuleFilter,
} from './lib/collection';

export {
  findDuplicateGranules,
} from './lib/duplicate-detection';

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
  getGranuleIdAndCollectionIdFromFile,
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
  updateBatchGranulesCollection,
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
  PdrSearch,
} from './search/PdrSearch';
export {
  ProviderSearch,
} from './search/ProviderSearch';
export {
  RuleSearch,
} from './search/RuleSearch';
export {
  StatsSearch,
} from './search/StatsSearch';
export {
  ReconciliationReportSearch,
} from './search/ReconciliationReportSearch';

export { AsyncOperationPgModel } from './models/async_operation';
export { BasePgModel } from './models/base';
export { CollectionPgModel } from './models/collection';
export { ExecutionPgModel } from './models/execution';
export { FilePgModel } from './models/file';
export { GranulePgModel } from './models/granule';
export { GranuleGroupsPgModel } from './models/granule-groups';
export { GranulesExecutionsPgModel } from './models/granules-executions';
export { PdrPgModel } from './models/pdr';
export { ProviderPgModel } from './models/provider';
export { ReconciliationReportPgModel } from './models/reconciliation_report';
export { RulePgModel } from './models/rule';
