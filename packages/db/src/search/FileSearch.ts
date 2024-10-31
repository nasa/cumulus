import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import pick from 'lodash/pick';
import set from 'lodash/set';
import { ApiFile } from '@cumulus/types';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { PostgresFileRecord } from '../types/file';
import { TableNames } from '../tables';
import { BaseRecord } from '../types/base';
import { translatePostgresFileToApiFile } from '../translate/file';

const log = new Logger({ sender: '@cumulus/db/ExecutionSearch' });

interface FileRecord extends BaseRecord, PostgresFileRecord{}

/**
 * Class to build and execute db search query for executions
 */
export class FileSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    // estimate the table rowcount by default
    if (event?.queryStringParameters?.estimateTableRowCount !== 'false') {
      set(event, 'queryStringParameters.estimateTableRowCount', 'true');
    }
    super(event, 'file');
  }

  /**
   * check if joined granules table search is needed
   *
   * @returns whether granules table search is needed
   */
  protected searchGranules(): boolean {
    const { not, term, terms } = this.dbQueryParameters;
    return (!!(not?.granuleCumulusId || term?.granuleCumulusId || terms?.granuleCumulusId));
  }

  /**
   * Build basic query
   *
   * @param knex - DB client
   * @returns queries for getting count and search result
   */
  protected buildBasicQuery(knex: Knex)
    : {
      countQuery: Knex.QueryBuilder,
      searchQuery: Knex.QueryBuilder,
    } {
    const {
      granules: granulesTable,
    } = TableNames;

    const searchQuery = knex(`${this.tableName}`)
      .select(`${this.tableName}.*`)
      .select({
        collectionName: `${granulesTable}.name`,
      });

    const countQuery = knex(this.tableName)
      .count('*');

    if (this.searchGranules()) {
      countQuery.innerJoin(granulesTable, `${this.tableName}.granule_cumulus_id`, `${granulesTable}.cumulus_id`);
      searchQuery.innerJoin(granulesTable, `${this.tableName}.granule_cumulus_id`, `${granulesTable}.cumulus_id`);
    } else {
      searchQuery.leftJoin(granulesTable, `${this.tableName}.granule_cumulus_id`, `${granulesTable}.cumulus_id`);
    }
    return { countQuery, searchQuery };
  }

  /**
   * Build queries for infix and prefix
   *
   * @param params
   * @param params.countQuery - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildInfixPrefixQuery(params: {
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { countQuery, searchQuery, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;
    if (infix) {
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.name`, `%${infix}%`));
    }
    if (prefix) {
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.name`, `%${prefix}%`));
    }
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: FileRecord[])
    : Partial<ApiFile>[] {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    const apiRecords = pgRecords.map((fileRecord: FileRecord) => {
      const apiRecord = translatePostgresFileToApiFile(fileRecord);
      return this.dbQueryParameters.fields
        ? pick(apiRecord, this.dbQueryParameters.fields)
        : apiRecord;
    });
    return apiRecords;
  }
}
