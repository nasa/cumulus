export interface ProviderClientListItem {
  name: string,
  path: string | undefined,
  size: number,
  time: number
}

export interface S3ObjectListItem {
  Bucket: string
  Key: string
  LastModified: Date
  Size: number
}

export interface FtpProviderClientListItem extends ProviderClientListItem {
  type: number
}

export interface S3ProviderClientListItem extends ProviderClientListItem {
}

export interface ProviderClient {
  connect(): Promise<void>

  end(): Promise<void>

  download(
    params: {
      remotePath: string,
      localPath: string,
      remoteAltBucket?: string,
    }
  ): Promise<string>

  list(path: string): Promise<ProviderClientListItem[]>

  sync(
    params: {
      fileRemotePath: string,
      destinationBucket: string,
      destinationKey: string,
      bucket?: string,
    }
  ): Promise<{ s3uri: string, etag?: string }>
}

export function isS3ObjectListItem(s3Object: any): s3Object is S3ObjectListItem {
  return (s3Object as S3ObjectListItem).Key !== undefined
    && (s3Object as S3ObjectListItem).Size !== undefined
    && (s3Object as S3ObjectListItem).LastModified !== undefined;
}
