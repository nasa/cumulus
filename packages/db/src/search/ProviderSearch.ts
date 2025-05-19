import { Knex } from 'knex';
import pick from 'lodash/pick';

import Logger from '@cumulus/logger';
import { ApiProvider } from '@cumulus/types/api/providers';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { translatePostgresProviderToApiProvider } from '../translate/providers';
import { PostgresProviderRecord } from '../types/provider';

const log = new Logger({ sender: '@cumulus/db/ProviderSearch' });

/**
 * Class to build and execute db search query for collections
 */
export class ProviderSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    const queryStringParameters = event.queryStringParameters || {};
    super({ queryStringParameters }, 'provider');
  }

  /**
   * Build queries for infix and prefix
   *
   * @param params
   * @param params.cteQueryBuilder - CTE query builder
   * @param [params.dbQueryParameters] - db query parameters
   * @param [params.cteName] - CTE name
   */
  protected buildInfixPrefixQuery(params: {
    cteQueryBuilder: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
    cteName?: string,
  }) {
    const { cteQueryBuilder, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;
    if (infix) {
      cteQueryBuilder.whereLike(`${this.tableName}.name`, `%${infix}%`);
    }
    if (prefix) {
      cteQueryBuilder.whereLike(`${this.tableName}.name`, `${prefix}%`);
    }
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres Provider records returned from query
   * @returns translated api records
   */
  protected async translatePostgresRecordsToApiRecords(pgRecords: PostgresProviderRecord[])
    : Promise<Partial<ApiProvider>[]> {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    const apiRecords = pgRecords.map((record) => {
      const apiRecord: ApiProvider = translatePostgresProviderToApiProvider(record);
      const apiRecordFinal = this.dbQueryParameters.fields
        ? pick(apiRecord, this.dbQueryParameters.fields)
        : apiRecord;
      return apiRecordFinal;
    });
    return apiRecords;
  }
}
