import Knex from 'knex';

import { tableNames } from './tables';
import { doesRecordExist } from './database';

export const doesAsyncOperationExist = async (params: object, knex: Knex) =>
  doesRecordExist(params, knex, tableNames.asyncOperations);
