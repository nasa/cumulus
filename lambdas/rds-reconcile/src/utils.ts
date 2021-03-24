import {
  Knex,
  BasePgModel,
  translateApiCollectionToPostgresCollection,
  PostgresCollection,
  CollectionPgModel,
} from '@cumulus/db';

import { NewCollectionRecord } from '@cumulus/types/api/collections';
import { ApiGatewayLambdaHttpProxyResponse } from '@cumulus/api-client/types';
import { ReportObj, StatsObject, CollectionMapping } from './types';

export const getDbCount = async (
  resultPromise: Promise<ApiGatewayLambdaHttpProxyResponse>
): Promise<number> => {
  const result = await resultPromise;
  return JSON.parse(result.body).meta.count;
};

export const generateCollectionReportObj = (stats: StatsObject[]) => {
  const reportObj = {} as ReportObj;
  stats.forEach((statsObj) => {
    const counts = statsObj.counts;
    if (counts[0] !== counts[3] || counts[1] !== counts[4] || counts[2] !== counts[5]) {
      reportObj[statsObj.collectionId] = {
        pdrsDelta: counts[0] - counts[3],
        totalPdrs: counts[0],
        granulesDelta: counts[1] - counts[4],
        totalGranules: counts[1],
        executionsDelta: counts[2] - counts[5],
        totalExecutions: counts[2],
      };
    }
  });
  return reportObj;
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

export const getPostgresModelCount = async <T, R extends { cumulus_id: number }>(params: {
  model: BasePgModel<T, R>,
  knexClient: Knex,
  cutoffIsoString?: string,
  queryParams?: ([string, string, string]|[Partial<R>])[],
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
        return { collection, postgresCollectionId: pgCollection.cumulus_id };
      } catch (error) {
        error.collection = `${name}, ${version}`;
        return Promise.reject(error);
      }
    }
  );
  const collectionMappingResults = await Promise.allSettled(
    collectionMappingPromises
  );

  const failedCollectionMappings = collectionMappingResults.filter(
    (mapping) => mapping.status === 'rejected'
  ) as PromiseRejectedResult[];
  const collectionMappings = collectionMappingResults.filter(
    (mapping) => mapping.status !== 'rejected'
  ) as PromiseFulfilledResult<CollectionMapping>[];
  const collectionValues = collectionMappings.map((result) => result.value);
  const collectionFailures = failedCollectionMappings.map((result) => result.reason);
  return {
    collectionValues,
    collectionFailures,
  };
};

export const getDynamoTableEntries = async (params: {
  dynamoCollectionModel: any,
  dynamoProvidersModel: any,
  dynamoRulesModel: any,
  dynamoAsyncRulesModel: any,
}) => {
  const {
    dynamoCollectionModel,
    dynamoProvidersModel,
    dynamoRulesModel,
    dynamoAsyncRulesModel,
  } = params;
  return Promise.all([
    dynamoCollectionModel.getAllCollections(),
    dynamoProvidersModel.getAllProviders(),
    dynamoRulesModel.getAllRules(),
    dynamoAsyncRulesModel.getAllAsyncOperations(),
  ]);
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
    collectionsDelta: dynamoCollectionsCount - postgresCollectionCount,
    totalDynamoCollections: dynamoCollectionsCount,
    providersDelta: dynamoProvidersCount - postgresProviderCount,
    totalDynamoProviders: dynamoProvidersCount,
    rulesDelta: dynamoRuleCount - postgresRulesCount,
    totalDynamoRules: dynamoRuleCount,
    asyncOperationsDelta: dynamoAsyncOperationsCount - postgresAsyncOperationsCount,
    totalDynamoAsyncOperations: dynamoAsyncOperationsCount,
  };
};
