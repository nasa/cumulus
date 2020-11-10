import { toSnake } from 'snake-camel';
// import { AsyncOperationRecord } from './types';

export const translateAsyncOperationToSnakeCase = (
  record: Object
): Object => toSnake(record);
