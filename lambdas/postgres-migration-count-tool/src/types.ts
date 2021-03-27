import { NewCollectionRecord } from '@cumulus/types/api/collections';

export type CollectionReportObject = {
  [key: string]: {
    pdrsDelta: number
    totalPdrs: number
    granulesDelta: number
    totalGranules: number
    executionsDelta: number
    totalExecutions:number
  };
};

export type AggregateReportObject = {
  collectionsDelta: number;
  totalDynamoCollections: number;
  providersDelta: number;
  totalDynamoProviders: number;
  rulesDelta: number;
  totalDynamoRules: number;
  asyncOperationsDelta: number;
  totalDynamoAsyncOperations: number;
};

export type EsCutoffQueryString = {
  fields: string[];
  createdAt__to: string;
  collectionId?: string
};

export type StatsObject = {
  collectionId: string;
  counts: [number, number, number, number, number, number];
};

export type CollectionMapping = {
  collection: NewCollectionRecord;
  postgresCollectionId: number;
};
