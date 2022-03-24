export type PdrStatus = 'running' | 'failed' | 'completed';

export interface ApiPdr {
  pdrName: string,
  provider: string,
  collectionId: string,
  status: PdrStatus,
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

export interface ApiPdrRecord extends ApiPdr {
  updatedAt: number
}
