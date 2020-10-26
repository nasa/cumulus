import Knex from 'knex';

import { tableNames } from './tables';
import { doesRecordExist } from './database';
import { CollectionRecord } from './types';

export const doesCollectionExist = async (
  params: Partial<CollectionRecord>,
  knex: Knex
) => doesRecordExist(params, knex, tableNames.collections);
