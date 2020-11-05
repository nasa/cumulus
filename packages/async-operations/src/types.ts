declare class AsyncOperationModelClass {
  constructor(params: { stackName: string, systemBucket: string, tableName?: string });
  create(...args: any): any | any[];
}
