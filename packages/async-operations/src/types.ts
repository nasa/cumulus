import { ApiAsyncOperation } from '@cumulus/types/api/async_operations';
export interface AsyncOperationModelClass {
  new(params: {
    stackName: string,
    systemBucket: string,
    tableName?: string
  }): AsyncOperationModelClass;
  create(...args: any): Promise<ApiAsyncOperation>;
  delete(...args: any): any | any[];
}

export interface AsyncOperationPgModelObject {
  create(...args: any): any | any[];
}
