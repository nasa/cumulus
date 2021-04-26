import Knex from 'knex';

import { RecordDoesNotExist } from '@cumulus/errors';

import { tableNames } from './tables';

export const isRecordDefined = <T>(record: T) => record !== undefined;
