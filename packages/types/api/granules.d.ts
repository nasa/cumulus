export type GranuleId = string;

export type GranuleStatus = 'completed' | 'failed' | 'running' | 'queued';

export interface ApiGranule {
  status: GranuleStatus
  files?: import('./files').ApiFile[]
}
