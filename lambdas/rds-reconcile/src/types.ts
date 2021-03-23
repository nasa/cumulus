import { NewCollectionRecord } from '@cumulus/types/api/collections';

export type ReportObj = {
  [key: string]: {
    pdrs: number,
    granules: number,
    executions: number,
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
