export interface DeadLetterArchivePayload {
  bucket?: string,
  path?: string,
}

export interface DLQRecord extends SQSRecord {
  error?: string | null
}

export interface DLARecord extends DLQRecord {
  error: string | null
  time: string | null
  status: string | null
  collection: string | null
  granules: Array<string | null> | null
  execution: string | null
  stateMachine: string | null
}
