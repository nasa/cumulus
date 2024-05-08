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
  getCollectionsByGranuleIds,
} from './lib/collection';

export {
  executionArnsFromGranuleIdsAndWorkflowNames,
  newestExecutionArnFromGranuleIdWorkflowName,
  getWorkflowNameIntersectFromGranuleIds,
  getApiExecutionCumulusIds,
  getApiGranuleExecutionCumulusIdsByExecution,
  getExecutionInfoByGranuleCumulusId,
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
  BaseSearch,
} from './search/BaseSearch';
export {
  GranuleSearch,
} from './search/GranuleSearch';

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
