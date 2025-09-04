export type GranuleId = string;

export type GranuleStatus = 'completed' | 'failed' | 'running' | 'queued';

export type GranuleTemporalInfo = {
  beginningDateTime: string
  endingDateTime: string
  productionDateTime: string
  lastUpdateDateTime: string
};

export interface MessageGranule {
  granuleId: string
  cmrLink?: string
  producerGranuleId?: string
  published?: boolean
  status?: string
  sync_granule_duration?: number
  post_to_cmr_duration?: number
  files?: import('./files').ApiFile[]
  createdAt?: number
}

export type NullablePartialType<T> = {
  [P in keyof T]?: T[P] | null;
};

type PartialGranuleTemporalInfo = NullablePartialType<GranuleTemporalInfo>;
type PartialGranuleProcessingInfo = NullablePartialType<import('./executions').ExecutionProcessingTimes>;

export type ApiGranuleRecord = {
  collectionId: string
  createdAt: number
  granuleId: string
  producerGranuleId: string
  status: GranuleStatus
  updatedAt: number
  cmrLink?: string
  duration?: number
  active?: boolean | null
  error?: Object
  execution?: string
  files?: Omit<import('./files').ApiFile, 'granuleId'>[]
  pdrName?: string
  productVolume?: string
  provider?: string
  published?: boolean
  queryFields?: unknown
  timestamp?: number
  timeToArchive?: number
  timeToPreprocess?: number
  archived: boolean
} & PartialGranuleTemporalInfo & PartialGranuleProcessingInfo;

export type ApiGranule = {
  granuleId: string
  collectionId: string
  archived: boolean
  producerGranuleId: string
  cmrLink?: string | null
  createdAt?: number | null
  duration?: number | null
  active?: boolean | null
  error?: Object | null
  execution?: string | null
  files?: Omit<import('./files').ApiFile, 'granuleId'>[] | null
  pdrName?: string | null
  producerGranuleId?: string | null
  productVolume?: string | null
  provider?: string | null
  published?: boolean | null
  queryFields?: unknown | null
  status?: GranuleStatus
  timestamp?: number | null
  timeToArchive?: number | null
  timeToPreprocess?: number | null
  updatedAt?: number | null
} & PartialGranuleTemporalInfo & PartialGranuleProcessingInfo;
