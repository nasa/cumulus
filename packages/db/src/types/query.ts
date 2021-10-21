import { PostgresGranuleRecord } from './granule';

export type ProviderNameColumn = {
  providerName: string
};

export type CollectionNameAndVersionColumns = {
  collectionName: string
  collectionVersion: string
};

export type GranuleWithProviderAndCollectionInfo =
  PostgresGranuleRecord
  & ProviderNameColumn
  & CollectionNameAndVersionColumns;
