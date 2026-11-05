/**
 * @module AthenaQueryClient
 */

import pRetry from 'p-retry';
import {
  AthenaClient,
  AthenaClientConfig,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  QueryExecutionState,
  GetQueryResultsCommand,
  ResultSet,
  ResultConfiguration,
  ResultReuseConfiguration,
  GetQueryResultsCommandOutput,
  ColumnInfo,
} from '@aws-sdk/client-athena';

import Logger from '@cumulus/logger';

const log = new Logger({ sender: 'aws-client/AthenaQueryClient' });

interface AthenaQueryClientConfig {
  clientConfig: AthenaClientConfig;
  database: string;
  catalog: string;
  resultConfiguration: ResultConfiguration;
  workGroup?: string;
  resultReuseConfiguration?: ResultReuseConfiguration;
}

type MappedObject = { [index: string]: string | undefined };
type MappedData = Array<MappedObject>;

export class AthenaQueryClient {
  private readonly database: string;
  private readonly client: AthenaClient;
  private readonly catalog: string;
  private readonly workGroup: string;
  private readonly resultConfiguration: ResultConfiguration;
  private readonly resultReuseConfiguration: ResultReuseConfiguration;

  constructor(config: AthenaQueryClientConfig) {
    this.workGroup = config.workGroup ?? 'primary';
    this.resultConfiguration = config.resultConfiguration;
    this.resultReuseConfiguration = config.resultReuseConfiguration ?? {
      ResultReuseByAgeConfiguration: {
        Enabled: true,
        MaxAgeInMinutes: 60,
      },
    };
    this.client = new AthenaClient(config.clientConfig);
    this.database = config.database;
    this.catalog = config.catalog;
  }

  /**
   * Get data from Athena and return it as proper formatted Array of objects
   *
   * @param sqlQuery - The SQL query string
   * @returns Array of Objects
   */
  public async query(sqlQuery: string): Promise<MappedData> {
    const queryExecutionId = await this.startQueryExecution(sqlQuery);
    return await this.waitForQueryAndGetData(queryExecutionId);
  }

  /**
   * Start Query Execution
   *
   * @param sqlQuery - The SQL query string
   * @returns QueryExecutionId - unique ID of the query run from request
   */
  private async startQueryExecution(sqlQuery: string): Promise<string> {
    const queryExecutionInput = {
      QueryString: sqlQuery,
      QueryExecutionContext: {
        Database: this.database,
        Catalog: this.catalog,
      },
      ResultConfiguration: this.resultConfiguration,
      WorkGroup: this.workGroup,
      ResultReuseConfiguration: this.resultReuseConfiguration,
    };
    log.info(`about to run query with ${JSON.stringify(queryExecutionInput)}`);

    const { QueryExecutionId: queryExecutionId } = await this.client.send(
      new StartQueryExecutionCommand(queryExecutionInput)
    );

    if (queryExecutionId === undefined) {
      throw new Error('QueryExecutionId was returned by Athena StartQueryExecutionCommand as undefined');
    }
    return queryExecutionId;
  }

  /**
   * Wait for query to complete and get data
   *
   * @param queryExecutionId - unique ID of the query run from request
   * @returns Array of Objects
   */
  private async waitForQueryAndGetData(queryExecutionId: string): Promise<MappedData> {
    const getQuery = async () => {
      const response = await this.client.send(
        new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId })
      );
      const state = response.QueryExecution?.Status?.State;
      log.info(`GetQueryExecution status check: ${state}`);
      if (state === QueryExecutionState.SUCCEEDED) {
        return await this.getQueryResults(queryExecutionId);
      }
      if (state === QueryExecutionState.QUEUED || state === QueryExecutionState.RUNNING) {
        throw new Error(`Query ${queryExecutionId} is still processing...`);
      }
      const reason = response.QueryExecution?.Status?.StateChangeReason || 'No reason provided';
      const errorMessage = `Unable to retrieve data from query ${queryExecutionId}. Status: ${state}. Reason: ${reason}`;
      log.debug(errorMessage);
      throw new pRetry.AbortError(errorMessage);
    };

    return await pRetry(getQuery, {
      factor: 2,
      minTimeout: 1000,
      maxTimeout: 30000,
      maxRetryTime: 3600000,
      onFailedAttempt: (error) => {
        log.info(`Attempt ${error.attemptNumber} failed (${error.retriesLeft} retries left): ${error.message}`);
      },
    });
  }

  /**
   * Get query execution result
   *
   * @param queryExecutionId - Id of a query which we sent to Athena
   * @returns Array of Objects
   */
  private async getQueryResults(queryExecutionId: string): Promise<MappedData> {
    const resultData: MappedData = [];
    let nextToken: string | undefined;
    let response: GetQueryResultsCommandOutput;
    let firstResponse = true;
    do {
      // eslint-disable-next-line no-await-in-loop
      response = await this.client.send(new GetQueryResultsCommand({
        QueryExecutionId: queryExecutionId,
        NextToken: nextToken,
      }));
      nextToken = response.NextToken;
      resultData.push(...this.formatResultSet(response.ResultSet, firstResponse));
      firstResponse = false;
    } while (nextToken);
    return resultData;
  }

  /**
   * Map data returned from Athena in rows, with each row an object with columns/keys and values.
   *
   * @param data - Data in rows returned from Athena Query, in the ResultSet format
   * @param firstResponse - denotes if data is from first response
   * @returns Array of rows of data as MappedObjects <columnName: stringValue>
   */
  private formatResultSet(
    data: ResultSet | undefined,
    firstResponse: boolean = false
  ): MappedData {
    const mappedData: MappedData = [];
    const columnInfo: ColumnInfo[] = data?.ResultSetMetadata?.ColumnInfo || [];
    data?.Rows?.forEach((item, i) => {
      if (i === 0 && firstResponse) return;
      if (!item.Data) return;

      const mappedObject: MappedObject = {};
      item.Data.forEach((datum, j) => {
        mappedObject[columnInfo[j].Name || ''] = datum.VarCharValue;
      });
      mappedData.push(mappedObject);
    });
    return mappedData;
  }
}
