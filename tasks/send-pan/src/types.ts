export interface Pdr {
  name: string,
  path?: string,
  [key: string]: unknown
}

export interface Pan {
  uri: string
}
export interface HandlerInput {
  pdr: Pdr,
  [key: string]: unknown
}

export interface HandlerOutput {
  pdr: Pdr,
  pan: Pan,
  [key: string]: unknown
}
export interface HandlerEvent {
  config: {
    provider: {
      protocol: string,
      host: string,
    },
    remoteDir: string | null,
  },
  input: HandlerInput,
}
