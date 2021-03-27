import {
  BasePgModel,
  CollectionPgModel,
  Knex,
  translateApiCollectionToPostgresCollection,
} from '@cumulus/db';
import { NewCollectionRecord } from '@cumulus/types/api/collections';
import { ApiGatewayLambdaHttpProxyResponse } from '@cumulus/api-client/types';
import {
  AggregateReportObject,
  CollectionMapping,
  CollectionReportObj,
  EsCutoffQueryString,
  StatsObject,
} from './types';

/**
* Given a pending API query promise, parses the object count out of the response
* @param {Promise<ApiGatewayLambdaHttpProxyResponse>} resultPromise - pending
* gateway proxy response
* @returns {Promise<number>} - returns the count reported via the
* API/Elasticsearch
*/
export const getDbCount = async (
  resultPromise: Promise<ApiGatewayLambdaHttpProxyResponse>
): Promise<number> => {
  const result = await resultPromise;
  return JSON.parse(result.body).meta.count;
};

/**
* Generates a CollectionReportObject
* @summary Generates a report containing the total Dynamo counts as well as the
* delta relative to postgres for use in the user output
* @param {StatsObject[]} stats - Array of stats objects to convert to user form
* @returns {CollectionReportObj}
*/
export const generateCollectionReportObj = (stats: StatsObject[]) => {
  const reportObj = {} as CollectionReportObj;
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

/**
* Generates a Elasticsearch query with a cutoff time query added
* @summary -  Generates a Elasticsearch query with a cutoff time query added,
* and optionally constrained by collectionId
* @param {string[]} fields - Elasticsearch query fields
* @param {number} cutoffTime - Epoch time to use for 'cutoff' filter
* @param {string} [collectionId] - Optional collectionId to limit query to
* @returns {EsCutoffQueryString} - Returns querystring object for use with
* Elasticsearch
*/
export const getEsCutoffQuery = (
  fields: string[],
  cutoffTime: number,
  collectionId?: string
): EsCutoffQueryString => {
  const returnObj = { fields, createdAt__to: `${cutoffTime}` };
  if (collectionId) {
    return { ...returnObj, collectionId };
  }
  return returnObj;
};

/**
* Given various query params, generates a 'count' of rows in the `model` table
* @summary - Given model, knexClient, a cutoffIsoString and Knex query
* parameters, return a table count
* @param {Object} params - parameter object
* @param {BasePgModel} model - `@cumulus/db` model instance
* @param {Knex} knexClient - `@cumulus/db` model instance
* @param {string} cutoffIsoString - ISO Date string for use in postgres query
* @param {string}  - ISO Date string for use in postgres query
* @param {([string, string, string]|[Partial<R>])[]} queryParams - Either a
* postgres ('value', 'comparator', 'value') object as an array, or a Partial
* record array
* @returns {Promise<number>} - Returns the count (as an integer)
*/
export const getPostgresModelCount = async <T, R extends { cumulus_id: number }>(params: {
  model: BasePgModel<T, R>,
  knexClient: Knex,
  cutoffIsoString?: string,
  queryParams?: ([string, string, string]|[Partial<R>])[],
}): Promise<number> => {
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

/**
* Creates an object consisting of a mapping of Dynamo collections and an array
* of failed mappings
* @param {NewCollectionRecord[]} dynamoCollections - Array of dynamo collection
* records to use to generate collection mappings.
* @param {CollectionPgModel} collectionModel -@cumulus/db collection model
* @param {Knex} knexClient - Knex client
* @param {Function } collectionTranslateFunction - Used for unit test injection
* @returns {Object} - Returns mapping object
*/
export const buildCollectionMappings = async (
  dynamoCollections: NewCollectionRecord[],
  collectionModel: CollectionPgModel,
  knexClient: Knex,
  // Arguments below are for unit test injection
  collectionTranslateFunction:
    typeof translateApiCollectionToPostgresCollection = translateApiCollectionToPostgresCollection
): Promise<{
  collectionValues: CollectionMapping[];
  collectionFailures: any[];
}> => {
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

/**
* Scans Collections, Providers, Rules and AsyncOperations
* @param {Object} params
* @param {Object} params.dynamoProvidersModel - Brief description of the
* parameter here. Note: For other notations of data types, please refer to
* JSDocs: DataTypes command.
* @param {Object} params.dynamoRulesModel - Brief description of the parameter
* here. Note: For other notations of data types, please refer to JSDocs:
* DataTypes command.
* @param {Object} params.dynamoCollectionModel - Brief description of the
* parameter here. Note: For other notations of data types, please refer to
* JSDocs: DataTypes command.
* @param {Object} params.dynamoAsyncOperationsModel - Brief description of the
* parameter here. Note: For other notations of data types, please refer to
* JSDocs: DataTypes command.
* @returns {Object[]} -- Returns dynamo scan responses
* here.
*/
export const getDynamoTableEntries = async (params: {
  dynamoCollectionModel: any,
  dynamoProvidersModel: any,
  dynamoRulesModel: any,
  dynamoAsyncOperationsModel: any,
}) => {
  const {
    dynamoCollectionModel,
    dynamoProvidersModel,
    dynamoRulesModel,
    dynamoAsyncOperationsModel,
  } = params;
  return Promise.all([
    dynamoCollectionModel.getAllCollections(),
    dynamoProvidersModel.getAllProviders(),
    dynamoRulesModel.getAllRules(),
    dynamoAsyncOperationsModel.getAllAsyncOperations(),
  ]);
};

/*
* Generates a report object for inclusion in the user report output
*/
export const generateAggregateReportObj = (params: {
  dynamoAsyncOperationsCount: number,
  dynamoCollectionsCount: number,
  dynamoProvidersCount: number,
  dynamoRuleCount: number,
  postgresAsyncOperationsCount: number,
  postgresCollectionCount: number,
  postgresProviderCount: number,
  postgresRulesCount: number,
}): AggregateReportObject => {
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
