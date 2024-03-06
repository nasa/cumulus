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
  collectionId: string | null
  providerId: string | null
  granules: Array<string | null> | null
  executionArn: string | null
  stateMachineArn: string | null
}
