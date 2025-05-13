import { Knex } from 'knex';
import pick from 'lodash/pick';

import Logger from '@cumulus/logger';
import { RuleRecord } from '@cumulus/types/api/rules';
import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { PostgresRuleRecord } from '../types/rule';
import { translatePostgresRuleToApiRuleWithoutDbQuery } from '../translate/rules';
import { TableNames } from '../tables';

const log = new Logger({ sender: '@cumulus/db/RuleSearch' });

interface RuleRecordWithExternals extends PostgresRuleRecord {
  collectionName: string,
  collectionVersion: string,
  providerName?: string,
}

/**
 * Class to build and execute db search query for rules
 */
export class RuleSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    super(event, 'rule');
  }

  protected buildSearch(knex: Knex) {
    const cteQueryBuilders = {};
    this.buildCTETermQuery({ knex, cteQueryBuilders });
    this.buildCTETermsQuery({ knex, cteQueryBuilders });
    this.buildCTEExistsQuery({ knex, cteQueryBuilders });
    this.buildCTENotMatchQuery({ knex, cteQueryBuilders });
    this.buildCTEInfixPrefixQuery({ knex, cteQueryBuilders });
    const cteSearchQueryBuilder = knex.queryBuilder();
    const searchQuery = this.joinCTESearchTables({ cteSearchQueryBuilder, cteQueryBuilders });
    const cteCountQueryBuilder = knex.queryBuilder();
    const countQuery = this.joinCTECountTables({ cteCountQueryBuilder, cteQueryBuilders });
    this.buildCTESortQuery({ searchQuery });
    if (this.dbQueryParameters.limit) searchQuery.limit(this.dbQueryParameters.limit);
    if (this.dbQueryParameters.offset) searchQuery.offset(this.dbQueryParameters.offset);

    log.debug(`buildSearch returns countQuery: ${countQuery?.toSQL().sql}, searchQuery: ${searchQuery.toSQL().sql}`);
    return { countQuery, searchQuery };
  }

  protected buildCTETermQuery(params: {
    knex: Knex,
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
    dbQueryParameters?: DbQueryParameters;
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
    } = TableNames;

    const { knex, cteQueryBuilders, dbQueryParameters } = params;
    const { term = {} } = dbQueryParameters ?? this.dbQueryParameters;

    this.buildCTETables({ knex, cteQueryBuilders, term });

    Object.entries(term).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilders[`${collectionsTable}`].where(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilders[`${collectionsTable}`].where(`${collectionsTable}.version`, value);
          break;
        case 'providerName':
          cteQueryBuilders[`${providersTable}`].where(`${providersTable}.name`, value);
          break;
        default:
          cteQueryBuilders[`${this.tableName}`].where(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

  protected buildCTETermsQuery(params: {
    knex: Knex; cteQueryBuilders:
    Record<string, Knex.QueryBuilder>;
    dbQueryParameters?: DbQueryParameters;
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
    } = TableNames;

    const { knex, cteQueryBuilders, dbQueryParameters } = params;
    const { terms = {} } = dbQueryParameters ?? this.dbQueryParameters;
    const term = terms;
    this.buildCTETables({ knex, cteQueryBuilders, term });

    Object.entries(terms).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilders[`${collectionsTable}`].whereIn(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilders[`${collectionsTable}`].whereIn(`${collectionsTable}.version`, value);
          break;
        case 'providerName':
          cteQueryBuilders[`${providersTable}`].whereIn(`${providersTable}.name`, value);
          break;
        default:
          cteQueryBuilders[`${this.tableName}`].whereIn(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

  protected buildCTENotMatchQuery(params: {
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
    dbQueryParameters?: DbQueryParameters;
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
    } = TableNames;

    const { knex, cteQueryBuilders, dbQueryParameters } = params;
    const { not: term = {} } = dbQueryParameters ?? this.dbQueryParameters;
    this.buildCTETables({ knex, cteQueryBuilders, term });

    Object.entries(term).forEach(([name, value]) => {
      switch (name) {
        case 'collectionName':
          cteQueryBuilders[`${collectionsTable}`].whereNot(`${collectionsTable}.name`, value);
          break;
        case 'collectionVersion':
          cteQueryBuilders[`${collectionsTable}`].whereNot(`${collectionsTable}.version`, value);
          break;
        case 'providerName':
          cteQueryBuilders[`${providersTable}`].whereNot(`${providersTable}.name`, value);
          break;
        default:
          cteQueryBuilders[`${this.tableName}`].whereNot(`${this.tableName}.${name}`, value);
          break;
      }
    });
  }

  protected buildCTEInfixPrefixQuery(params: {
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { knex, cteQueryBuilders, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;

    if (!(`${this.tableName}` in cteQueryBuilders)) cteQueryBuilders[`${this.tableName}`] = knex.select('*').from(`${this.tableName}`);

    if (infix) {
      cteQueryBuilders[`${this.tableName}`].whereLike(`${this.tableName}.name`, `%${infix}%`);
    }
    if (prefix) {
      cteQueryBuilders[`${this.tableName}`].whereLike(`${this.tableName}.name`, `${prefix}%`);
    }
  }

  protected buildCTETables(params: {
    knex: Knex;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
    term: any }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
    } = TableNames;

    const { knex, cteQueryBuilders, term } = params;

    //Object.entries(term).forEach(([name, value]) => {
    Object.keys(term).forEach((name) => {
      switch (name) {
        case 'collectionVersion':
        case 'collectionName':
          if (!(`${collectionsTable}` in cteQueryBuilders)) {
            cteQueryBuilders[`${collectionsTable}`] = knex.select('*').from(`${collectionsTable}`);
          }
          break;
        case 'providerName':
          if (!(`${providersTable}` in cteQueryBuilders)) {
            cteQueryBuilders[`${providersTable}`] = knex.select('*').from(`${providersTable}`);
          }
          break;
        default:
          if (!(`${this.tableName}` in cteQueryBuilders)) {
            cteQueryBuilders[`${this.tableName}`] = knex.select('*').from(`${this.tableName}`);
          }
          break;
      }
    });
  }

  protected joinCTESearchTables(params: {
    cteSearchQueryBuilder: Knex.QueryBuilder;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
    } = TableNames;

    const { cteSearchQueryBuilder, cteQueryBuilders } = params;
    Object.entries(cteQueryBuilders).forEach(([tableName, cteQuery]) => {
      cteSearchQueryBuilder.with(`${tableName}_cte`, cteQuery);
    });

    let mainTableName = `${this.tableName}`;
    if (`${this.tableName}` in cteQueryBuilders) {
      mainTableName = `${this.tableName}_cte`;
      cteSearchQueryBuilder.from(`${this.tableName}_cte`);
    } else {
      cteSearchQueryBuilder.from(`${this.tableName}`);
    }
    let collectionsTableName = `${collectionsTable}`;
    if (`${collectionsTable}` in cteQueryBuilders) {
      collectionsTableName = `${collectionsTable}_cte`;
      cteSearchQueryBuilder.innerJoin(`${collectionsTable}_cte`, `${mainTableName}.collection_cumulus_id`, `${collectionsTable}_cte.cumulus_id`);
    } else {
      cteSearchQueryBuilder.leftJoin(`${collectionsTable}`, `${mainTableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }
    let providersTableName = `${providersTable}`;
    if (`${providersTable}` in cteQueryBuilders) {
      providersTableName = `${providersTable}_cte`;
      cteSearchQueryBuilder.innerJoin(`${providersTable}_cte`, `${mainTableName}.provider_cumulus_id`, `${providersTable}_cte.cumulus_id`);
    } else {
      cteSearchQueryBuilder.leftJoin(`${providersTable}`, `${mainTableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    }

    cteSearchQueryBuilder.select(
      `${mainTableName}.*`,
      `${collectionsTableName}.name as collectionName`,
      `${collectionsTableName}.version as collectionVersion`,
      `${providersTableName}.name as providerName`
    );

    return cteSearchQueryBuilder;
  }

  protected joinCTECountTables(params: {
    cteCountQueryBuilder: Knex.QueryBuilder;
    cteQueryBuilders: Record<string, Knex.QueryBuilder>;
  }) {
    const {
      collections: collectionsTable,
      providers: providersTable,
    } = TableNames;

    const { cteCountQueryBuilder, cteQueryBuilders } = params;
    Object.entries(cteQueryBuilders).forEach(([tableName, cteQuery]) => {
      cteCountQueryBuilder.with(`${tableName}_cte`, cteQuery);
    });

    let mainTableName = `${this.tableName}`;
    if (`${this.tableName}` in cteQueryBuilders) {
      mainTableName = `${this.tableName}_cte`;
      cteCountQueryBuilder.from(`${this.tableName}_cte`);
    } else {
      cteCountQueryBuilder.from(`${this.tableName}`);
    }
    if (`${collectionsTable}` in cteQueryBuilders) {
      cteCountQueryBuilder.innerJoin(`${collectionsTable}_cte`, `${mainTableName}.collection_cumulus_id`, `${collectionsTable}_cte.cumulus_id`);
    } else {
      cteCountQueryBuilder.leftJoin(`${collectionsTable}`, `${mainTableName}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`);
    }
    if (`${providersTable}` in cteQueryBuilders) {
      cteCountQueryBuilder.innerJoin(`${providersTable}_cte`, `${mainTableName}.provider_cumulus_id`, `${providersTable}_cte.cumulus_id`);
    } else {
      cteCountQueryBuilder.leftJoin(`${providersTable}`, `${mainTableName}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    }
    cteCountQueryBuilder.countDistinct(
      `${mainTableName}.cumulus_id as count`
    );

    return cteCountQueryBuilder;
  }

  protected buildCTESortQuery(params: {
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { searchQuery, dbQueryParameters } = params;
    const { sort } = dbQueryParameters || this.dbQueryParameters;
    // const table = cteName || this.tableName;
    sort?.forEach((key) => {
      if (key.column.startsWith('error')) {
        searchQuery.orderByRaw(
          `${this.tableName}_cte.error ->> 'Error' ${key.order}`
        );
      } else if (dbQueryParameters?.collate) {
        searchQuery.orderByRaw(
          `${key} collate \"${dbQueryParameters.collate}\"`
        );
      } else {
        searchQuery.orderBy([key]);
      }
    });
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres Rule records returned from query
   * @returns translated api records
   */
  protected async translatePostgresRecordsToApiRecords(
    pgRecords: RuleRecordWithExternals[]
  ): Promise<Partial<RuleRecord>[]> {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);

    const apiRecords = pgRecords.map(async (record) => {
      const providerPgRecord = record.providerName ? { name: record.providerName } : undefined;
      const collectionPgRecord = record.collectionName ? {
        name: record.collectionName,
        version: record.collectionVersion,
      } : undefined;
      const apiRecord = await translatePostgresRuleToApiRuleWithoutDbQuery(
        record,
        collectionPgRecord,
        providerPgRecord
      );
      return this.dbQueryParameters.fields
        ? pick(apiRecord, this.dbQueryParameters.fields)
        : apiRecord;
    });
    return await Promise.all(apiRecords);
  }
}
