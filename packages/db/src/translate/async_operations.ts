import { toSnake } from 'snake-camel';
import { ApiAsyncOperation } from '@cumulus/types/api/async_operations';
import { PostgresAsyncOperation } from '../types/async_operation';

export const translateApiAsyncOperationToPostgresAsyncOperation = (
  record: ApiAsyncOperation
): PostgresAsyncOperation => {
  // fix for old implementation of async-operation output assignment
  const translatedRecord = <PostgresAsyncOperation>toSnake(record);
  if (record.output === 'none') {
    delete translatedRecord.output;
  } else if (record.output !== undefined) {
    translatedRecord.output = JSON.parse(record.output);
  }
  if (record.createdAt !== undefined) {
    translatedRecord.created_at = new Date(record.createdAt);
  }
  if (record.updatedAt !== undefined) {
    translatedRecord.updated_at = new Date(record.updatedAt);
  }
  return translatedRecord;
};
