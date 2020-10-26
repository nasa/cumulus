export interface AsyncOperationRecord {
  id: string
  description: string
  operationType: string
  status: string
  output?: object
  taskArn?: string
  created_at: Date
  updated_at: Date
}

export interface CollectionRecord {
  name: string
  version: string
  process: string
  granuleIdValidationRegex: string
  granuleIdExtractionRegex: string
  files: string
  duplicateHandling?: string
  reportToEms?: boolean
  sampleFileName?: string
  url_path?: string
  ignoreFilesConfigForDiscovery?: boolean
  meta?: object
  tags?: string
  created_at: Date
  updated_at: Date
}

export interface ExecutionRecord {
  arn: string
  asyncOperationCumulusId?: number
  collectionCumulusId?: number
  parentCumulusId?: number
  cumulus_version: string
  created_at: Date
  updated_at: Date
}

export interface ProviderRecord {
  name: string
  protocol: string
  host: string
  port?: number
  username?: string
  password?: string
  globalConnectionLimit?: number
  privateKey?: string
  cmKeyId?: string
  certificateUri?: string
  created_at: Date
  updated_at?: Date
}
