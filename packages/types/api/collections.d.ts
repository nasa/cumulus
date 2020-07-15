// eslint-disable-next-line import/extensions
import { DuplicateHandling } from '..';

export type CollectionFile = {
  bucket: string,
  regex: string,
  sampleFileName: string,
  checksumFor?: string
  type?: string,
  url_path?: string,
};

export type CollectionRecord = {
  createdAt: number,
  files: CollectionFile[],
  granuleId: string,
  granuleIdExtraction: string,
  name: string,
  sampleFileName: string,
  updatedAt: number,
  version: string,
  duplicateHandling?: DuplicateHandling,
  ignoreFilesConfigForDiscovery?: boolean,
  process?: string,
  reportToEms?: boolean,
  tags?: string[],
  url_path?: string
};
