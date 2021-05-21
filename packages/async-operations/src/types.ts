export interface AsyncOperationModelClass {
  new(params: { stackName: string, systemBucket: string, tableName?: string }): any;
  create(...args: any): any | any[];
}

export interface AsyncOperationPgModelObject {
  create(...args: any): any | any[];
}
