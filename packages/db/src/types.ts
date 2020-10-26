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
