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
  getEsCutoffQuery,
  getPostgresModelCount,
} from './utils';

import { StatsObject, CollectionMapping } from './types';

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

  const [
    dynamoCollections,
    dynamoProviders,
    dynamoRules,
    dynamoAsyncOperations,
  ] = await Promise.all([
    dynamoCollectionModel.getAllCollections(),
    dynamoProvidersModel.getAllProviders(),
    dynamoRulesModel.getAllRules(),
    dynamoAsyncRulesModel.getAllAsyncOperations(),
  ]);

  // Get dynamo table counts
  const dynamoAsyncOperationsCount = dynamoAsyncOperations.length;
  const dynamoCollectionsCount = dynamoCollections.length;
  const dynamoProvidersCount = dynamoProviders.length;
  const dynamoRuleCount = dynamoRules.length;

  // Get postgres table counts
  const postgresProviderCount = await getPostgresModelCount({
    model: postgresProviderModel,
    knexClient,
    cutoffIsoString,
  });
  const postgresRulesCount = await getPostgresModelCount({
    model: postgresRulesModel,
    knexClient,
    cutoffIsoString,
  });
  const postgresAsyncOperationsCount = await getPostgresModelCount({
    model: postgresAsyncOperationModel,
    knexClient,
    cutoffIsoString,
  });
  const postgresCollectionCount = await getPostgresModelCount({
    model: postgresCollectionModel,
    knexClient,
    cutoffIsoString,
  });

  const {
    collectionValues,
    collectionFailures,
  } = await buildCollectionMappings(
    dynamoCollections,
    postgresCollectionModel,
    knexClient
  );

  if (collectionFailures.length > 0) {
    logger.warn(`Warning - failed to map ${collectionFailures.length} / ${dynamoCollectionsCount}: ${JSON.stringify(collectionFailures)}`);
  }

  const mapper = async (collectionMap: CollectionMapping): Promise<StatsObject> => {
    const { collection, postgresCollectionId } = collectionMap;
    const collectionId = `${collection.name}___${collection.version}`;
    return {
      collectionId,
      counts: await Promise.all([
        getDbCount(
          getPdrs({
            prefix,
            query: getEsCutoffQuery(
              ['pdrName', 'createdAt'],
              cutoffTime,
              collectionId
            ),
          })
        ),
        getDbCount(
          listGranules({
            prefix,
            query: getEsCutoffQuery(
              ['granuleId', 'createdAt'],
              cutoffTime,
              collectionId
            ),
          })
        ),
        getDbCount(
          getExecutions({
            prefix,
            query: getEsCutoffQuery(
              ['execution', 'createdAt'],
              cutoffTime,
              collectionId
            ),
          })
        ),
        getPostgresModelCount({
          model: postgresGranuleModel,
          knexClient,
          cutoffIsoString,
          queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
        }),
        getPostgresModelCount({
          model: postgresPdrModel,
          knexClient,
          cutoffIsoString,
          queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
        }),
        getPostgresModelCount({
          model: postgresExecutionModel,
          knexClient,
          cutoffIsoString,
          queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
        }),
      ]),
    };
  };
  const collectionReportResults = await pMap(collectionValues, mapper, { concurrency: dbConcurrency });
  const collectionReportObj = await generateCollectionReportObj(collectionReportResults);

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

handler({
  reportBucket: 'cumulus-test-sandbox-internal',
  reportPath: 'jk-test-reports',
  systemBucket: 'cumulus-test-sandbox-internal',
  stackName: 'jk-tf4',
});
