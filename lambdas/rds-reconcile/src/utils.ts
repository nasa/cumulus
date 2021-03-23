import {
  Knex,
  BasePgModel,
  CollectionPgModel,
  translateApiCollectionToPostgresCollection,
  PostgresCollection,
} from '@cumulus/db';
import { NewCollectionRecord } from '@cumulus/types/api/collections';

export const getDbCount = async (resultPromise: any): Promise<number> => {
  const result = await resultPromise;
  return JSON.parse(result.body).meta.count;
};

export const generateCollectionReportObj = (stats: StatsObject[]) => {
  const reportObj = {} as ReportObj;
  stats.forEach((statsObj) => {
    const counts = statsObj.counts;
    if (counts[0] !== counts[3] || counts[1] !== counts[4] || counts[2] !== counts[5]) {
      reportObj[statsObj.collectionId] = {
        pdrs: counts[0] - counts[3],
        granules: counts[1] - counts[4],
        executions: counts[2] - counts[5],
      };
    }
  });
  return reportObj;
};

export const getDynamoScanStats = async (
  collectionsModel: { getAllCollections: any },
  providersModel: { getAllProviders: any },
  rulesModel: { getAllRules: any },
  asyncRulesModel: { getAllAsyncOperations: any }
) => Promise.all([
  collectionsModel.getAllCollections(),
  providersModel.getAllProviders(),
  rulesModel.getAllRules(),
  asyncRulesModel.getAllAsyncOperations(),
]);

export const getPostgresCount = async (resultPromise: any) => {
  const result = await resultPromise;
  return Number(result[0].count);
};

// TODO consider consolidation with getPostgresCount
export const getPostgresModelCutoffCount = <T, R extends { cumulus_id: number}>(
  model: BasePgModel<T, R>,
  knexClient: Knex,
  cutoffIsoString: string
) => getPostgresCount(model.count(knexClient, [['created_at', '<', cutoffIsoString]]));

export const getPostgresModelCount = async <T, R extends { cumulus_id: number }>(params: {
  model: BasePgModel<T, R>,
  knexClient: Knex,
  cutoffIsoString?: string,
  queryParams: ([string, string, string]|[Partial<R>])[],
}) => {
  const {
    model,
    knexClient,
    cutoffIsoString,
    queryParams = [],
  } = params;

  if (cutoffIsoString) {
    queryParams.push(['created_at', '<', cutoffIsoString]);
  }
  const result = await model.count(knexClient, queryParams);
  return Number(result[0].count);
};

export const getEsCutoffQuery = (
  fields: string[],
  cutoffTime: number,
  collectionId?: string
) => {
  const returnObj = { fields, createdAt__to: `${cutoffTime}` };
  if (collectionId) {
    return { ...returnObj, collectionId };
  }
  return returnObj;
};

// TODO parameterize
export const buildCollectionMappings = async (
  dynamoCollections: NewCollectionRecord[],
  collectionModel: CollectionPgModel,
  knexClient: Knex,
  collectionTranslateFunction: (
    (record: any) => PostgresCollection
  ) = translateApiCollectionToPostgresCollection
) => {
  const collectionMappingPromises = dynamoCollections.map(
    async (collection) => {
      const { name, version } = collectionTranslateFunction(
        collection
      );
      try {
        const pgCollection = await collectionModel.get(knexClient, {
          name,
          version,
        });
        return [collection, pgCollection.cumulus_id];
      } catch (error) {
        error.collection = `${name}, ${version}`;
        return Promise.reject(error);
      }
    }
  );
  const collectionMappingResults = await Promise.allSettled(
    collectionMappingPromises
  );

  // TODO: This is ineffective, fix it.
  const failedCollectionMappings = collectionMappingResults.filter(
    (mapping) => mapping.status === 'rejected'
  );
  const collectionMappings = collectionMappingResults.filter(
    (mapping) => mapping.status !== 'rejected'
  );
  return {
    collectionMappings,
    failedCollectionMappings,
  };
};

export const generateAggregateReportObj = (params: {
  dynamoAsyncOperationsCount: number,
  dynamoCollectionsCount: number,
  dynamoProvidersCount: number,
  dynamoRuleCount: number,
  postgresAsyncOperationsCount: number,
  postgresCollectionCount: number,
  postgresProviderCount: number,
  postgresRulesCount: number,
}) => {
  const {
    dynamoAsyncOperationsCount,
    dynamoCollectionsCount,
    dynamoProvidersCount,
    dynamoRuleCount,
    postgresAsyncOperationsCount,
    postgresCollectionCount,
    postgresProviderCount,
    postgresRulesCount,
  } = params;

  return {
    collections: dynamoCollectionsCount - postgresCollectionCount,
    providers: dynamoProvidersCount - postgresProviderCount,
    rules: dynamoRuleCount - postgresRulesCount,
    asyncOperations: dynamoAsyncOperationsCount - postgresAsyncOperationsCount,
  };
};
