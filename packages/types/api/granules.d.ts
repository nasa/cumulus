export type GranuleId = string;

export type GranuleStatus = 'completed' | 'failed' | 'running';

export interface ApiGranule {
  status: GranuleStatus
}
