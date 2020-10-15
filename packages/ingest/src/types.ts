export interface ProviderClientListItem {

}

export interface S3ProviderClientListItem extends ProviderClientListItem {
  name: string,
  path: string | undefined,
  size: number,
  time: number
}

export interface ProviderClient {
  connect(): Promise<void>

  end(): Promise<void>

  download(remotePath: string, localPath: string): Promise<string>

  list(path: string): Promise<ProviderClientListItem[]>

  sync(
    sourcePath: string,
    destinationBucket: string,
    destinationKey: string
  ): Promise<{s3uri: string, etag: string}>
}
