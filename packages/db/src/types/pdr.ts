import { PdrStatus } from '@cumulus/types/api/pdrs';

export interface PostgresPdr {
  status: PdrStatus
  name: string
  collection_cumulus_id: number
  provider_cumulus_id: number
  execution_cumulus_id?: string
  progress?: number
  pan_sent?: boolean
  pan_message?: string
  stats?: object
  address?: string
  original_url?: string
  duration?: number
  timestamp?: Date
  created_at?: Date
  updated_at?: Date
}

export interface PostgresPdrRecord extends PostgresPdr {
  cumulus_id: number
  created_at: Date
  updated_at: Date
}
