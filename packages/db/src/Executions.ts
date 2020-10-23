import Knex from 'knex';

import { tableNames } from './tables';
import { doesRecordExist } from './database';

export const doesExecutionExist = async (params: object, knex: Knex) =>
  doesRecordExist(params, knex, tableNames.executions);
