export const asyncOperations: {
  getAsyncOperation: ({ prefix, asyncOperationId, callback }: {
    prefix: string;
    asyncOperationId: Object;
    callback: Function;
  }) => Promise<Object>;
};
export const collections: {
  createCollection: ({ prefix, collection, callback }: {
    prefix: string;
    collection: Object;
    callback: Function;
  }) => Promise<Object>;
  deleteCollection: ({ prefix, collectionName, collectionVersion, callback }: {
    prefix: string;
    collectionVersion: Object;
    collectionName: Object;
    callback: Function;
  }) => Promise<Object>;
  getCollection: ({ prefix, collectionName, collectionVersion, callback }: {
    prefix: string;
    collectionVersion: Object;
    collectionName: Object;
    callback: Function;
  }) => Promise<Object>;
  getCollections: ({ prefix, callback }: {
    prefix: string;
    callback: Function;
  }) => Promise<Object>;
};
export const cumulusApiClient: {
  invokeApi: ({ prefix, payload }: {
    prefix: string;
    payload: string;
  }) => Promise<Object>;
};
export const ems: {
  createEmsReports: ({ prefix, request, callback }: {
    prefix: string;
    request: Object;
    callback: Function;
  }) => Promise<Object>;
  getLambdaEmsSettings: (lambdaName: string) => Promise<Object>;
};
export const executions: {
  getExecution: ({ prefix, arn, callback }: {
    prefix: string;
    arn: string;
    callback: Function;
  }) => Promise<Object>;
  getExecutions: ({ prefix, callback }: {
    prefix: string;
    callback: Function;
  }) => Promise<Object>;
  getExecutionStatus: ({ prefix, arn, callback }: {
    prefix: string;
    arn: string;
    callback: Function;
  }) => Promise<Object>;
};
export const granules: {
  getGranule: ({ prefix, granuleId, callback }: {
    prefix: string;
    granuleId: string;
    callback: Function;
  }) => Promise<Object>;
  reingestGranule: ({ prefix, granuleId, callback }: {
    prefix: string;
    granuleId: string;
    callback: Function;
  }) => Promise<Object>;
  removeFromCMR: ({ prefix, granuleId, callback }: {
    prefix: string;
    granuleId: string;
    callback: Function;
  }) => Promise<Object>;
  applyWorkflow: ({ prefix, granuleId, workflow, callback }: {
    prefix: string;
    granuleId: string;
    workflow: string;
    callback: Function;
  }) => Promise<Object>;
  deleteGranule: ({ prefix, granuleId, callback }: {
    prefix: string;
    granuleId: string;
    callback: Function;
  }) => Promise<Object>;
  listGranules: ({ prefix, query, callback }: {
    query: string;
    callback: Function;
  }) => Promise<Object>;
  moveGranule: ({ prefix, granuleId, destinations, callback }: {
    prefix: string;
    granuleId: string;
    destinations: Object[];
    callback: Function;
  }) => Promise<Object>;
  waitForGranule: ({ prefix, granuleId, status, retries, callback }: {
    granuleId: string;
    retries: number;
    callback: Function;
  }) => Promise<void>;
  removePublishedGranule: ({ prefix, granuleId, callback }: {
    prefix: string;
    granuleId: string;
    callback: Function;
  }) => Promise<Object>;
  bulkDeleteGranules: ({ prefix, body, callback }: {
    body: Object;
    callback: Function;
  }) => Promise<Object>;
};
export const invokeApi: ({ prefix, payload }: {
  prefix: string;
  payload: string;
}) => Promise<Object>;
export const providers: {
  createProvider: ({ prefix, provider, callback }: {
    prefix: string;
    provider: string;
    callback: Function;
  }) => Promise<Object>;
  deleteProvider: ({ prefix, providerId, callback }: {
    prefix: string;
    providerId: string;
    callback: Function;
  }) => Promise<Object>;
  getProvider: ({ prefix, providerId, callback }: {
    prefix: string;
    providerId: string;
    callback: Function;
  }) => Promise<Object>;
  getProviders: ({ prefix, callback }: {
    prefix: string;
  }) => Promise<Object>;
};
export const reconciliationReports: {
  getReconciliationReport: ({ prefix, name, callback }: {
    prefix: string;
    name: string;
    callback: Function;
  }) => Promise<Object>;
  deleteReconciliationReport: ({ prefix, name, callback }: {
    prefix: string;
    name: string;
    callback: Function;
  }) => Promise<Object>;
  createReconciliationReport: ({ prefix, request, callback }: {
    prefix: string;
    request: Object;
    callback: Function;
  }) => Promise<Object>;
};
export const rules: {
  postRule: ({ prefix, rule, callback }: {
    prefix: string;
    rule: Object;
    callback: Function;
  }) => Promise<Object>;
  updateRule: ({ prefix, ruleName, updateParams, callback }: {
    prefix: string;
    ruleName: Object;
    updateParams: Object;
    callback: Function;
  }) => Promise<Object>;
  deleteRule: ({ prefix, ruleName, callback }: {
    prefix: string;
    ruleName: string;
    callback: Object;
  }) => Promise<Object>;
  getRule: ({ prefix, ruleName, callback }: {
    prefix: string;
    ruleName: string;
    callback: Object;
  }) => Promise<Object>;
  listRules: ({ prefix, query, callback }: {
    prefix: string;
    query: string;
    callback: Object;
  }) => Promise<Object>;
  rerunRule: ({ prefix, ruleName, updateParams, callback }: {
    prefix: string;
    ruleName: string;
    updateParams: Object;
    callback: Object;
  }) => Promise<Object>;
};
//# sourceMappingURL=index.d.ts.map
