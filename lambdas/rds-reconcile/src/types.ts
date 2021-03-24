import { NewCollectionRecord } from '@cumulus/types/api/collections';

export type ReportObj = {
  [key: string]: {
    pdrsDelta: number
    totalPdrs: number
    granulesDelta: number
    totalGranules: number
    executionsDelta: number
    totalExecutions:number
  };
};

export type StatsObject = {
  collectionId: string;
  counts: [number, number, number, number, number, number];
};

export type CollectionMapping = {
  collection: NewCollectionRecord;
  postgresCollectionId: number;
};
