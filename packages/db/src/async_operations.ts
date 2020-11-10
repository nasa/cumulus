import { toSnake } from 'snake-camel';

interface CamelCaseAsyncOperation {
  id: string
  description: string
  operationType: string
  status: string
  output?: object
  taskArn?: string
  createdAt?: Date
  updatedAt?: Date
}

interface SnakeCaseAsyncOperation {
  id: string
  description: string
  operation_type: string
  status: string
  output?: object
  task_arn?: string
  created_at?: Date
  updated_at?: Date
}

export const translateAsyncOperationToSnakeCase = (
  record: CamelCaseAsyncOperation
): SnakeCaseAsyncOperation => {
  const translatedRecord: SnakeCaseAsyncOperation = <SnakeCaseAsyncOperation>toSnake(record);
  if(record.output !== undefined) {
    translatedRecord.output = record.output;
  }
  return translatedRecord;
};
