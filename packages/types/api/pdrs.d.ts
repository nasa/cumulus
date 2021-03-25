export type pdrStatus = 'running' | 'failed' | 'completed';

export interface ApiPdr {
  pdrName: string,
  provider: string,
  collectionId: string,
  status: pdrStatus,
  createdAt?: number,
  progress?: number,
  execution?: string,
  PANSent?: boolean,
  PANmessage?: string,
  stats?: {
    total?: number,
    completed?: number,
    failed?: number,
    processing?: number,
  },
  address?: string,
  originalUrl?: string,
  timestamp?: number,
  duration?: number,
  updatedAt?: number,
}
