import Knex from 'knex';

import { tableNames } from './tables';
import { doesRecordExist } from './database';
import { ExecutionRecord } from './types';

export const doesExecutionExist = async (
  params: Partial<ExecutionRecord>,
  knex: Knex
) => doesRecordExist(params, knex, tableNames.executions);
