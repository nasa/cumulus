export interface Pdr {
  name: string,
  path?: string,
  [key: string]: unknown
}

export interface FailedExecution {
  arn: string
  reason: string
}

export interface Pan {
  uri: string
}
export interface HandlerInput {
  pdr: Pdr,
  running: string[],
  completed: string[],
  failed: FailedExecution[],
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
