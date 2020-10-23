import Knex from 'knex';

import { tableNames } from './tables';
import { getDbClient } from './database';

export const doesExecutionExist = async (params: object, knex: Knex) =>
  await getDbClient(knex, tableNames.executions).where(params).first() !== undefined;
