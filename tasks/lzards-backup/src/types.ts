export interface HandlerInput {
  granules: MessageGranule[],
  [key: string]: unknown
}

export interface HandlerEvent {
  config: {
    algorithm: string
  },
  input: HandlerInput
}

export type MessageGranuleFilesObject = {
  checksumType: string,
  checksum: string,
  fileName: string,
  backup: boolean,
  [key: string]: any;
};

export interface MessageGranule {
  granuleId: string,
  dataType?: string,
  version?: string,
  files: MessageGranuleFilesObject[],
}
