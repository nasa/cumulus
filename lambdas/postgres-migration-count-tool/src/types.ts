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

export type reportObject = {
  collectionsNotMapped: any[],
  records_in_dynamo_not_in_postgres: AggregateReportObject,
  pdr_granule_and_execution_records_not_in_postgres_by_collection: CollectionReportObject,
  s3Uri?: string
};

export type CollectionMapping = {
  collection: NewCollectionRecord;
  postgresCollectionId: number;
};
