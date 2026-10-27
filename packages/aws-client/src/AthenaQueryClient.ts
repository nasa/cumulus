import pRetry from 'p-retry';
import {
  AthenaClient,
  AthenaClientConfig,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  QueryExecutionState,
  GetQueryResultsCommand,
  GetQueryResultsCommandOutput,
  ResultSet,
  Datum,
  // --- IMPORT NATIVE AWS TYPES ---
  ResultConfiguration,
  ResultReuseConfiguration,
} from '@aws-sdk/client-athena';
import Logger from '@cumulus/logger';

const log = new Logger({ sender: 'aws-client/AthenaQueryClient' });

export interface AthenaQueryClientConfig {
  ClientConfig: AthenaClientConfig;
  Database: string;
  Catalog: string;
  ResultConfiguration: ResultConfiguration; // Native Type
  WorkGroup?: string;
  ResultReuseConfiguration?: ResultReuseConfiguration; // Native Type
}

export type MappedObject = Record<string, string>;
export type MappedData = MappedObject[];

export class AthenaQueryClient {
  public readonly database: string;
  private readonly client: AthenaClient;
  private readonly catalog: string;
  private readonly workGroup: string;
  private readonly resultConfiguration: ResultConfiguration;
  private readonly resultReuseConfiguration: ResultReuseConfiguration;

  constructor(config: AthenaQueryClientConfig) {
    this.client = new AthenaClient(config.ClientConfig);
    this.database = config.Database;
    this.catalog = config.Catalog;
    this.workGroup = config.WorkGroup ?? 'primary';
    this.resultConfiguration = config.ResultConfiguration;
    this.resultReuseConfiguration = config.ResultReuseConfiguration ?? {
      ResultReuseByAgeConfiguration: {
        Enabled: true,
        MaxAgeInMinutes: 60,
      },
    };
  }

  /**
   * Get data from Athena and return it as properly formatted Array of objects
   */
  async query(sqlQuery: string): Promise<MappedData | undefined> {
    const queryExecutionId = await this.startQueryExecution(sqlQuery);
    const response = await this.waitForQueryAndGetData(queryExecutionId);
    log.info('Response from waitForQueryAndGetData completed.');
    return response;
  }

  /**
   * Start Query Execution
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
    log.info(`About to run query with ${JSON.stringify(queryExecutionInput)}`);

    const { QueryExecutionId } = await this.client.send(
      new StartQueryExecutionCommand(queryExecutionInput)
    );
    log.info(`From query execution, got back ${QueryExecutionId}`);

    if (!QueryExecutionId) {
      throw new Error('QueryExecutionId was returned by Athena StartQueryExecutionCommand as undefined');
    }
    return QueryExecutionId;
  }

  /**
   * Polls query execution status using p-retry with automatic exponential backoff.
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
   * Public method to stream pages of query results iteratively using an Async Generator.
   * Useful for large datasets to avoid loading everything into memory at once.
   */
  public async *streamQueryResults(sqlQuery: string): AsyncGenerator<MappedData, void, unknown> {
    const queryExecutionId = await this.startQueryExecution(sqlQuery);
    await this.waitForQueryAndGetData(queryExecutionId);

    let nextToken: string | undefined;
    let dataColumns: string[] | undefined;

    do {
      // eslint-disable-next-line no-await-in-loop
      const response: GetQueryResultsCommandOutput = await this.client.send(
        new GetQueryResultsCommand({
          QueryExecutionId: queryExecutionId,
          NextToken: nextToken,
        })
      );

      const pageData = this.mapData(response.ResultSet, dataColumns);

      if (!dataColumns && response.ResultSet?.Rows && response.ResultSet.Rows.length > 0) {
        dataColumns = response.ResultSet.Rows[0].Data?.map((col: Datum) => col.VarCharValue ?? '') ?? [];
      }

      // Yield the current page of records to the caller iteratively
      yield pageData;

      nextToken = response.NextToken;
    } while (nextToken);
  }

  /**
   * Get query execution result with pagination handling
   */
  private async getQueryResults(queryExecutionId: string): Promise<MappedData> {
    let data: MappedData = [];
    let nextToken: string | undefined;
    let dataColumns: string[] | undefined;

    do {
      // eslint-disable-next-line no-await-in-loop
      const response: GetQueryResultsCommandOutput = await this.client.send(
        new GetQueryResultsCommand({
          QueryExecutionId: queryExecutionId,
          NextToken: nextToken,
        })
      );

      const pageData = this.mapData(response.ResultSet, dataColumns);

      if (!dataColumns && response.ResultSet?.Rows && response.ResultSet.Rows.length > 0) {
        dataColumns = response.ResultSet.Rows[0].Data?.map((col: Datum) => col.VarCharValue ?? '') ?? [];
      }

      data = data.concat(pageData);
      nextToken = response.NextToken;
    } while (nextToken);

    return data;
  }

  /**
   * Map data returned from Athena rows into cleanly formatted object records.
   */
  public mapData(
    data: ResultSet | undefined,
    dataColumns?: string[]
  ): MappedData {
    const mappedData: MappedData = [];
    if (!data?.Rows || data.Rows.length === 0) return mappedData;

    let columns: string[];
    if (dataColumns !== undefined) {
      columns = dataColumns;
    } else {
      columns = data.Rows[0].Data?.map((column: Datum) => column.VarCharValue ?? '') ?? [];
    }

    data.Rows.forEach((item, i) => {
      if (i === 0 && dataColumns === undefined) return;
      if (!item.Data) return;

      const mappedObject: MappedObject = {};
      item.Data.forEach((datum: Datum, j) => {
        const columnName = columns[j] || `column_${j}`;
        mappedObject[columnName] = datum.VarCharValue ?? '';
      });

      mappedData.push(mappedObject);
    });

    return mappedData;
  }
}
