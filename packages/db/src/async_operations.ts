import { toSnake } from 'snake-camel';
import { ApiAsyncOperation } from '@cumulus/types/api/async_operations';
import { PostgresAsyncOperation } from './types';

export const translateApiAsyncOperationToPostgresAsyncOperation = (
  record: ApiAsyncOperation
): PostgresAsyncOperation => {
  const translatedRecord = <PostgresAsyncOperation>toSnake(record);
  if (record.output !== undefined) {
    translatedRecord.output = record.output;
  }
  if (record.createdAt !== undefined) {
    translatedRecord.created_at = new Date(record.createdAt);
  }
  if (record.updatedAt !== undefined) {
    translatedRecord.updated_at = new Date(record.updatedAt);
  }
  return translatedRecord;
};
