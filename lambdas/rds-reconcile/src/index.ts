//import { Context } from 'aws-lambda';
import pMap from 'p-map';

import { models } from '@cumulus/api';
import * as S3 from '@cumulus/aws-client/S3';
import { getExecutions } from '@cumulus/api-client/executions';
import { listGranules } from '@cumulus/api-client/granules';
import { getPdrs } from '@cumulus/api-client/pdrs';
import { envUtils } from '@cumulus/common';

import Logger from '@cumulus/logger';
import {
  CollectionPgModel,
  GranulePgModel,
  AsyncOperationPgModel,
  RulePgModel,
  PdrPgModel,
  ExecutionPgModel,
  ProviderPgModel,
  getKnexClient,
} from '@cumulus/db';

import {
  buildCollectionMappings,
  generateAggregateReportObj,
  generateCollectionReportObj,
  getDbCount,
  getDynamoScanStats,
  getEsCutoffQuery,
  getPostgresCount,
  getPostgresModelCutoffCount,
} from './utils';

const logger = new Logger({
  sender: '@cumulus/lambdas/rds-reconcile',
});

// Required Env
// DEPLOYMENT
// SYSTEM_BUCKET
const handler = async (
  event: {
    dbConcurrency?: number,
    dbMaxPool?: number,
    reportBucket?: string,
    reportPath?: string,
    cutoffSeconds?: number,
    systemBucket?: string,
    stackName?: string
  }
): Promise<any> => {
  const {
    dbConcurrency = 20,
    dbMaxPool = 20,
    reportBucket,
    reportPath,
    cutoffSeconds = 3600,
    systemBucket = envUtils.getRequiredEnvVar('SYSTEM_BUCKET'),
    stackName = envUtils.getRequiredEnvVar('DEPLOYMENT'),
  } = event;
  process.env.dbMaxPool = `${dbMaxPool}`;

  logger.debug(`Running reconciliation with ${JSON.stringify(event)}`);
  const prefix = process.env.DEPLOYMENT || '';
  const knexClient = await getKnexClient({ env: process.env });
  const cutoffTime = Date.now() - cutoffSeconds * 1000;
  const cutoffIsoString = new Date(cutoffTime).toISOString();

  // Take handler structure
  const dynamoCollectionModel = new models.Collection(); // set env var
  const dynamoProvidersModel = new models.Provider(); // set env var
  const dynamoRulesModel = new models.Rule(); // set env var

  const dynamoAsyncRulesModel = new models.AsyncOperation({
    stackName,
    systemBucket,
  });

  const postgresGranuleModel = new GranulePgModel();
  const postgresExecutionModel = new ExecutionPgModel();
  const postgresPdrModel = new PdrPgModel();
  const postgresAsyncOperationModel = new AsyncOperationPgModel();
  const postgresCollectionModel = new CollectionPgModel();
  const postgresProviderModel = new ProviderPgModel();
  const postgresRulesModel = new RulePgModel();

  // TODO -- should this be abstracted
  const [
    dynamoCollections,
    dynamoProviders,
    dynamoRules,
    dynamoAsyncOperations,
  ] = await getDynamoScanStats(
    dynamoCollectionModel,
    dynamoProvidersModel,
    dynamoRulesModel,
    dynamoAsyncRulesModel,
  );



  // Get dynamo table counts
  const dynamoAsyncOperationsCount = dynamoAsyncOperations.length;
  const dynamoCollectionsCount = dynamoCollections.length;
  const dynamoProvidersCount = dynamoProviders.length;
  const dynamoRuleCount = dynamoRules.length;

  // Get postgres table counts
  const postgresProviderCount = await getPostgresModelCutoffCount(
    postgresProviderModel,
    knexClient,
    cutoffIsoString
  );
  const postgresRulesCount = await getPostgresModelCutoffCount(
    postgresRulesModel,
    knexClient,
    cutoffIsoString
  );
  const postgresAsyncOperationsCount = await getPostgresModelCutoffCount(
    postgresAsyncOperationModel,
    knexClient,
    cutoffIsoString
  );
  const postgresCollectionCount = await getPostgresModelCutoffCount(
    postgresCollectionModel,
    knexClient,
    cutoffIsoString
  );

  const elasticSearchPdrCount = await getDbCount(
    getPdrs({
      prefix,
      query: await getEsCutoffQuery(['pdrName', 'createdAt'], cutoffTime),
    })
  );
  const elasticSearchGranuleCount = await getDbCount(
    listGranules({
      prefix,
      query: await getEsCutoffQuery(['granuleId', 'createdAt'], cutoffTime),
    })
  );
  const elasticSearchExecutionCount = await getDbCount(
    getExecutions({
      prefix,
      query: await getEsCutoffQuery(['execution', 'createdAt'], cutoffTime),
    })
  );

  console.log(`${elasticSearchPdrCount}, ${elasticSearchGranuleCount}, ${elasticSearchExecutionCount}`);

  const {
    collectionMappings,
    failedCollectionMappings,
  } = await buildCollectionMappings(
    dynamoCollections,
    postgresCollectionModel,
    knexClient
  );

  if (failedCollectionMappings.length > 0) {
    logger.warn(`Warning - failed to map ${failedCollectionMappings} / ${dynamoCollectionsCount}: ${JSON.stringify(failedCollectionMappings)}`);
  }

  const mapper = async (collectionMap: any): Promise<StatsObject> => {
    const [collection, pgCollectionId] = collectionMap.value;
    const collectionId = `${collection.name}___${collection.version}`;
    return {
      collectionId,
      counts: await Promise.all([
        getDbCount(getPdrs({ prefix, query: (getEsCutoffQuery(['pdrName', 'createdAt'], cutoffTime, collectionId)) })),
        getDbCount(listGranules({ prefix, query: (getEsCutoffQuery(['granuleId', 'createdAt'], cutoffTime, collectionId)) })),
        getDbCount(getExecutions({ prefix, query: (getEsCutoffQuery(['execution', 'createdAt'], cutoffTime, collectionId)) })),
        getPostgresCount(postgresPdrModel.count(
          knexClient,
          [['created_at', '<', cutoffIsoString], [{ collection_cumulus_id: pgCollectionId }]]
        )),
        getPostgresCount(postgresGranuleModel.count(
          knexClient,
          [['created_at', '<', cutoffIsoString], [{ collection_cumulus_id: pgCollectionId }]]
        )),
        getPostgresCount(postgresExecutionModel.count(
          knexClient,
          [['created_at', '<', cutoffIsoString], [{ collection_cumulus_id: pgCollectionId }]]
        )),
      ]),
    };
  };

  const collectionReportObj = generateCollectionReportObj(
    await pMap(collectionMappings, mapper, { concurrency: dbConcurrency })
  );

  const aggregateReportObj = generateAggregateReportObj({
    dynamoAsyncOperationsCount,
    dynamoCollectionsCount,
    dynamoProvidersCount,
    dynamoRuleCount,
    postgresAsyncOperationsCount,
    postgresCollectionCount,
    postgresProviderCount,
    postgresRulesCount,
  });

  const reportObj = {
    records_in_dynamo_not_in_postgres: aggregateReportObj,
    pdr_granule_and_execution_records_not_in_postgres_by_collection: collectionReportObj,
  };

  // Output results
  logger.info(`Records found in dynamo not found in postgres: ${JSON.stringify(aggregateReportObj)}`);
  if (Object.keys(collectionReportObj)) {
    logger.error('Collection discrepancies found!');
    logger.error('Details::');
    logger.error(JSON.stringify(collectionReportObj));
  }

  // Write report object to S3
  if (reportBucket && reportPath) {
    logger.info(`Writing report to ${reportBucket}/${reportPath}/reconcileReport-${cutoffTime}`);
    await S3.putJsonS3Object(
      reportBucket,
      `${reportPath}/reconcileReport-${cutoffTime}`,
      reportObj
    );
  }
  logger.info('Execution complete');
  return reportObj;
};
