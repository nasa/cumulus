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
} from '@aws-sdk/client-athena';

import isNil from 'lodash/isNil';
import Logger from '@cumulus/logger';

const log = new Logger({ sender: 'aws-client/AthenaQueryClient' });

interface AthenaQueryClientConfig {
  ClientConfig: AthenaClientConfig;
  Database: string;
  Catalog: string;
  ResultConfiguration: ResultConfiguration;
  WorkGroup?: string;
  ResultReuseConfiguration?: ResultReuseConfiguration;
}

type MappedObject = { [index: string]: string };
type MappedData = Array<MappedObject>;

export class AthenaQueryClient {
  public readonly database: string;
  private readonly client: AthenaClient;
  private readonly catalog: string;
  private readonly workGroup: string = 'primary';
  private readonly resultConfiguration: ResultConfiguration | undefined;
  private readonly resultReuseConfiguration: ResultReuseConfiguration = {
    ResultReuseByAgeConfiguration: {
      Enabled: true,
      MaxAgeInMinutes: 60,
    },
  };

  constructor(config: AthenaQueryClientConfig) {
    this.client = new AthenaClient(config.ClientConfig);
    this.database = config.Database;
    this.catalog = config.Catalog;

    if (config.WorkGroup) this.workGroup = config.WorkGroup;
    if (config.ResultConfiguration) {
      this.resultConfiguration = config.ResultConfiguration;
    }
    if (config.ResultReuseConfiguration) {
      this.resultReuseConfiguration = config.ResultReuseConfiguration;
    }
  }

  /**
   * Get data from Athena and rerutn it as proper formatted Array of objects
   *
   * @param sqlQuery - The SQL query string
   * @returns Array of Objects
   */
  async query(sqlQuery: string): Promise<MappedData | undefined> {
    const queryExecutionId = await this.startQueryExecution(sqlQuery);

    const response = await this.waitForQueryAndGetData(queryExecutionId);
    return response;
  }

  /**
   * Start Query Execution
   *
   * @param sqlQuery - The SQL query string
   * @returns QueryExecutionId - unique ID of the query run from request
   */
  async startQueryExecution(sqlQuery: string): Promise<string> {
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

    const { QueryExecutionId } = await this.client.send(
      new StartQueryExecutionCommand(queryExecutionInput)
    );

    if (QueryExecutionId === undefined) {
      throw new Error('QueryExecutionId was returned by Athena StartQueryExecutionCommand as undefined');
    }
    return QueryExecutionId;
  }

  /**
   * Start Query Execution
   *
   * @param queryExecutionId - unique ID of the query run from request
   * @returns Array of Objects
   */
  private async waitForQueryAndGetData(queryExecutionId: string): Promise<MappedData | undefined> {
    const runCheck = async () => {
      const response = await this.client.send(
        new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId })
      );
      const state = response.QueryExecution?.Status?.State;
      log.info(`GetQueryExecution status check: ${state}`);

      if (state === QueryExecutionState.SUCCEEDED) {
        return await this.getQueryResults(queryExecutionId);
      }

      if (state === QueryExecutionState.FAILED) {
        // Use AbortError so p-retry stops attempting immediately on terminal failure
        throw new pRetry.AbortError(
          `Query failed: ${response.QueryExecution?.Status?.StateChangeReason ?? 'Unknown reason'}`
        );
      }

      if (state === QueryExecutionState.CANCELLED) {
        throw new pRetry.AbortError('Query was cancelled');
      }

      if (state === QueryExecutionState.QUEUED || state === QueryExecutionState.RUNNING) {
        throw new Error(`Query ${queryExecutionId} is still processing...`);
      }

      throw new pRetry.AbortError(`Unhandled query state encountered: ${state}`);
    };

    // Orchestrate exponential checking using p-retry options matching your parameters
    return await pRetry(runCheck, {
      factor: 2, // Double the delay duration every step
      minTimeout: 1000, // Start at 1 second
      maxTimeout: 30000, // Cap individual sleep intervals at 30 seconds
      maxRetryTime: 3600000, // Total timeout threshold limit of 1 hour
      onFailedAttempt: (error) => {
        log.info(`Attempt ${error.attemptNumber} failed (${error.retriesLeft} retries left): ${error.message}`);
      },
    });
  }

  /**
   * Get query execution result
   *
   * @param QueryExecutionId - Id of a query which we sent to Athena
   * @returns Array of Objects
   */
  private async getQueryResults(QueryExecutionId: string): Promise<MappedData> {
    const data = [] as MappedData;
    let response = await this.client.send(new GetQueryResultsCommand({
      QueryExecutionId,
    }));

    let nextToken = response?.NextToken?.toString() || '';
    data.push(...this.mapData(response.ResultSet));
    let dataColumns = [] as string[];
    if (response?.ResultSet?.ResultSetMetadata?.ColumnInfo !== undefined) {
      dataColumns = Object.keys(response.ResultSet?.ResultSetMetadata?.ColumnInfo[0]);
    }

    while (nextToken !== '') {
      // eslint-disable-next-line no-await-in-loop
      response = await this.client.send(new GetQueryResultsCommand({
        QueryExecutionId,
        NextToken: nextToken,
      }));
      nextToken = response?.NextToken?.toString() || '';
      // eslint-disable-next-line no-await-in-loop
      data.push(...this.mapData(response.ResultSet, dataColumns));
    }
    return data;
  }

  /**
   * Map data returned from Athena in rows, with each row an object with columns/keys and values.
   *
   * @param - Data in rows returned from Athena Query, in the ResultSet format
   * @returns Array of rows of data as MappedObjects <columnName: stringValue>
   */
  public mapData(
    data: ResultSet | undefined,
    dataColumns?: string[]
  ): MappedData {
    const mappedData: MappedData = [];
    if (data === undefined || data.Rows === undefined || data.Rows.length === 0) return mappedData;
    let columns: string[];
    if (dataColumns !== undefined) {
      columns = dataColumns;
    } else if (data.ResultSetMetadata?.ColumnInfo !== undefined) {
      columns = Object.keys(data.ResultSetMetadata?.ColumnInfo[0]);
    }

    data.Rows.forEach((item, i) => {
      if (i === 0 && dataColumns === undefined) return;
      if (!item.Data) return;

      const mappedObject: MappedObject = {};
      item.Data.forEach((datum, j) => {
        if (isNil(datum.VarCharValue)) {
          mappedObject[columns[j]] = '';
        } else {
          mappedObject[columns[j]] = datum.VarCharValue;
        }
      });

      mappedData.push(mappedObject);
    });

    return mappedData;
  }
}
