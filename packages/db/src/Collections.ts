import Knex from 'knex';

import { tableNames } from './tables';
import { doesRecordExist } from './database';

export const doesCollectionExist = async (params: object, knex: Knex) =>
  doesRecordExist(params, knex, tableNames.collections);
