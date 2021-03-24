import pMap from 'p-map';

import { models } from '@cumulus/api';
import * as S3 from '@cumulus/aws-client/S3';
import { envUtils } from '@cumulus/common';
import Logger from '@cumulus/logger';
import {
  AsyncOperationPgModel,
  CollectionPgModel,
  getKnexClient,
  ProviderPgModel,
  RulePgModel,
} from '@cumulus/db';

import {
  buildCollectionMappings,
  generateAggregateReportObj,
  generateCollectionReportObj,
  getPostgresModelCount,
  getDynamoTableEntries,
} from './utils';

import { pMapMapper } from './mapper';

const logger = new Logger({
  sender: '@cumulus/lambdas/rds-reconcile',
});

/**
* Reconciliation Handler -- generates counts comparing dynamo/es with a postgres
* database
* @param {Object} event - Lambda event
* @param {string} event.systemBucket = process.env.SYSTEM_BUCKET - Cumulus
* deployment's system bucket
* @param {string} event.stackName = process.env.DEPLOYMENT - Cumulus
* deployment's DEPLOYMENT
* @param {number} [event.dbConcurrency = 20] - Max number of concurrent queries
* when generating collection reports
* @param {number} [event.dbMaxPool=20] - Max size of Knex db connection pool
* @param {string} [event.reportBucket] - Bucket to write count report output to
* @param {string} [event.reportPath] - Path to output count report to
* @param {number} [event.cutoffSeconds = 3600] - Number of seconds in the past
* to count backward from. This allows you to explicitly set a window relative to
* the execution of this tool to avoid 'leading edge' ingest processes that may
* not have completed/populated elasticsearch/etc.
* @returns {Promise<reportObj>} -- Returns a reportObj containing the report
* outputs from the run
*/
export const handler = async (
  event: {
    dbConcurrency?: number,
    dbMaxPool?: number,
    reportBucket?: string,
    reportPath?: string,
    cutoffSeconds?: number,
    systemBucket?: string,
    stackName?: string,
    // Arguments below are for unit test injection
    getPostgresModelCountFunction?: typeof getPostgresModelCount,
    mapperFunction?: typeof pMapMapper,
    buildCollectionMappingsFunction?: typeof buildCollectionMappings,
    getDynamoTableEntriesFunction?: typeof getDynamoTableEntries,
    getKnexClientFunction?: typeof getKnexClient,
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
    getKnexClientFunction = getKnexClient,
    getPostgresModelCountFunction = getPostgresModelCount,
    mapperFunction = pMapMapper,
    buildCollectionMappingsFunction = buildCollectionMappings,
    getDynamoTableEntriesFunction = getDynamoTableEntries,
  } = event;
  process.env.dbMaxPool = `${dbMaxPool}`;

  logger.debug(`Running reconciliation with ${JSON.stringify(event)}`);
  const prefix = process.env.DEPLOYMENT || '';
  const knexClient = await getKnexClientFunction({ env: process.env });
  const cutoffTime = Date.now() - cutoffSeconds * 1000;
  const cutoffIsoString = new Date(cutoffTime).toISOString();

  const dynamoCollectionModel = new models.Collection();
  const dynamoProvidersModel = new models.Provider();
  const dynamoRulesModel = new models.Rule();

  const dynamoAsyncOperationsModel = new models.AsyncOperation({
    stackName,
    systemBucket,
  });

  const postgresAsyncOperationModel = new AsyncOperationPgModel();
  const postgresCollectionModel = new CollectionPgModel();
  const postgresProviderModel = new ProviderPgModel();
  const postgresRulesModel = new RulePgModel();

  const [
    dynamoCollections,
    dynamoProviders,
    dynamoRules,
    dynamoAsyncOperations,
  ] = await getDynamoTableEntriesFunction({
    dynamoCollectionModel,
    dynamoProvidersModel,
    dynamoRulesModel,
    dynamoAsyncOperationsModel,
  });
  const dynamoAsyncOperationsCount = dynamoAsyncOperations.length;
  const dynamoCollectionsCount = dynamoCollections.length;
  const dynamoProvidersCount = dynamoProviders.length;
  const dynamoRuleCount = dynamoRules.length;

  // Get postgres table counts
  const postgresProviderCount = await getPostgresModelCountFunction({
    model: postgresProviderModel,
    knexClient,
    cutoffIsoString,
  });
  const postgresRulesCount = await getPostgresModelCountFunction({
    model: postgresRulesModel,
    knexClient,
    cutoffIsoString,
  });
  const postgresAsyncOperationsCount = await getPostgresModelCountFunction({
    model: postgresAsyncOperationModel,
    knexClient,
    cutoffIsoString,
  });

  const postgresCollectionCount = await getPostgresModelCountFunction({
    model: postgresCollectionModel,
    knexClient,
    cutoffIsoString,
  });

  const {
    collectionValues,
    collectionFailures,
  } = await buildCollectionMappingsFunction(
    dynamoCollections,
    postgresCollectionModel,
    knexClient
  );
  if (collectionFailures.length > 0) {
    logger.warn(`Warning - failed to map ${collectionFailures.length} / ${dynamoCollectionsCount}: ${JSON.stringify(collectionFailures)}`);
  }

  // Generate report of pdr/executions/granules count differences for each collection.  Return
  // mapping of collections with differences
  const collectionReportResults = await pMap(
    collectionValues,
    mapperFunction.bind(undefined, cutoffIsoString, cutoffTime, knexClient, prefix),
    { concurrency: dbConcurrency }
  );

  // Reformat stats objects to user-readable data
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

  // Create output report
  const reportObj = {
    collectionsNotMapped: collectionFailures,
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
