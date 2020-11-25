import { createErrorType } from '@cumulus/errors';

export const RecordAlreadyMigrated = createErrorType('RecordAlreadyMigrated');
export const ColumnDoesNotExist = createErrorType('ColumnDoesNotExist');
