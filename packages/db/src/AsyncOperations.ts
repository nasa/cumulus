import Knex from 'knex';

import { tableNames } from './tables';
import { doesRecordExist } from './database';
import { AsyncOperationRecord } from './types';

export const doesAsyncOperationExist = async (
  params: Partial<AsyncOperationRecord>,
  knex: Knex
) => doesRecordExist(params, knex, tableNames.asyncOperations);
