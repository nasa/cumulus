/**
 * module AthenaQueryClient
 */

import {
  AthenaClient,
  AthenaClientConfig,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  QueryExecutionState,
  GetQueryExecutionCommandOutput,
  GetQueryResultsCommand,
  ResultSet,
} from '@aws-sdk/client-athena';

import isNil from 'lodash/isNil';
import Logger from '@cumulus/logger';

const log = new Logger({ sender: 'aws-client/AthenaQueryClient' });

interface ResultReuseConfiguration {
  ResultReuseByAgeConfiguration: {
    Enabled: boolean,
    MaxAgeInMinutes?: number,
  }
}
interface ResultConfiguration {
  OutputLocation: string;
  EncryptionConfiguration?: { // EncryptionConfiguration
    EncryptionOption: 'SSE_S3' | 'SSE_KMS' | 'CSE_KMS'; // required
    KmsKey?: string;
  };
  ExpectedBucketOwner?: string;
  AclConfiguration?: { // AclConfiguration
    S3AclOption: 'BUCKET_OWNER_FULL_CONTROL'; // required
  };
}

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
  public database: string;
  private client: AthenaClient;
  private catalog: string;
  private workGroup: string = 'primary';
  private resultConfiguration: ResultConfiguration | undefined;
  private resultReuseConfiguration: ResultReuseConfiguration = {
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
   * @param {string} sqlQuery - The SQL query string
   * @returns {Array} Array of Objects
   */
  async query(sqlQuery: string): Promise<MappedData | undefined> {
    const queryExecutionId = await this.startQueryExecution(sqlQuery);

    const response = await this.checkQueryExecutionStateAndGetData(queryExecutionId);
    log.info(`response (${typeof response}) from checkQueryExecutionStateAndGetData: ${JSON.stringify(response)}`);
    return response;
  }

  /**
   * Start Query Execution
   *
   * @param {string} sqlQuery - The SQL query string
   * @returns {string} QueryExecutionId - unique ID of the query run from request
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
    log.info(`from query execution, got back ${QueryExecutionId}, which is a ${typeof QueryExecutionId}`);

    if (QueryExecutionId === undefined) {
      throw new Error('QueryExecutionId was returned by Athena StartQueryExecutionCommand as undefined');
    }
    return QueryExecutionId;
  }

  /**
   * Get query execution status and output
   *
   * @param {string} QueryExecutionId - Id of a query which we sent to Athena
   * @returns {GetQueryExecutionCommandOutput} - output from GetQueryExecutionCommand
   */
  private async getQueryExecution(
    QueryExecutionId: string
  ): Promise<GetQueryExecutionCommandOutput> {
    const command = new GetQueryExecutionCommand({ QueryExecutionId });
    return await this.client.send(command);
  }

  /**
   * Check query exeqution state
   * if it is "QUEUED" or "RUNNING", recursively call to check the state
   * with increasing polling delays until the state is "SUCCEEDED" and after it we get the data
   *
   * @param {string} QueryExecutionId - Id of a query which we sent to Athena
   * @param {number} delay - polling interval passed in, in millisecs
   * @returns {Array} Array of Objects
   */
  private async checkQueryExecutionStateAndGetData(
    QueryExecutionId: string,
    delay: number = 0
  ): Promise<MappedData | undefined> {
    const response = await this.getQueryExecution(QueryExecutionId);
    const state = response.QueryExecution?.Status?.State;
    log.info(`response (${typeof response}) and state (${typeof state}) ${state} from GetQueryExecutionCommand. ${JSON.stringify(response)}`);

    if (state === QueryExecutionState.FAILED) {
      throw new Error(`Query failed: ${response.QueryExecution!.Status!.StateChangeReason}`);
    } else if (state === QueryExecutionState.CANCELLED) {
      throw new Error('Query was cancelled');
    } else if (state === QueryExecutionState.SUCCEEDED) {
      return await this.getQueryResults(QueryExecutionId);
    } else if (state === QueryExecutionState.QUEUED || state === QueryExecutionState.RUNNING) {
      // polling intervals: 1000 (1s), 600000 (10m), 3600000 (60m/1h)
      let delayPass = delay;
      if (delayPass <= 1000) {
        delayPass = 1000;
        await this.timeout(delayPass);
        delayPass += 4000;
      } else if (delayPass <= 600000) {
        await this.timeout(delayPass);
        delayPass *= 2;
      } else if (delayPass <= 3600000) {
        await this.timeout(delayPass);
        delayPass += 600000;
      } else {
        log.error(`delays have become ${delayPass}, longer than an hour. time to abort`);
        throw new Error(`Query ${QueryExecutionId} was queued or running for too long`);
      }

      log.info(`about to rerun checkQueryExecutionStateAndGetData with delay ${delayPass} (also ${delayPass / 1000}s)`);
      return await this.checkQueryExecutionStateAndGetData(QueryExecutionId, delayPass);
    }
    log.error(`end of checkQueryExecutionStateAndGetData reached, state ${state} not processed. response: ${JSON.stringify(response)}`);
    return undefined;
  }

  /**
   * Get query execution result
   *
   * @param {string} QueryExecutionId - Id of a query which we sent to Athena
   * @returns {Array} Array of Objects
   */
  private async getQueryResults(QueryExecutionId: string): Promise<MappedData> {
    const response = await this.client.send(new GetQueryResultsCommand({
      QueryExecutionId,
    }));
    log.info(`response (${typeof response}) from GetQueryResults: ${JSON.stringify(response)}`);
    return this.mapData(response.ResultSet);
  }

  /**
   * Map data returned from Athena in rows, with each row an object with columns/keys and values.
   *
   * @param {ResultSet} data - Data in rows returned from Athena Query, in the ResultSet format
   * @returns {MappedData} Array of rows of data as MappedObjects <columnName: stringValue>
   */
  mapData(data: ResultSet | undefined): MappedData {
    const mappedData: MappedData = [];
    if (data === undefined || data.Rows === undefined || data.Rows.length === 0) return mappedData;

    const columns: string[] = data.Rows[0].Data!.map((column) => column.VarCharValue as string);

    data.Rows.forEach((item, i) => {
      if (i === 0) return;
      if (item.Data === undefined) return;

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

  /**
   * Simple helper timeout function uses in checkQueryExecutionStateAndGetData function
   *
   * @param {number} msTime - Time in miliseconds
   * @returns {Promise} Promise
   */
  private timeout(msTime: number) {
    return new Promise((resolve) => setTimeout(resolve, msTime));
  }
}
