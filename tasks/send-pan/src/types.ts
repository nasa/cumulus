export type Pdr = {
  name: string,
  path?: string,
  [key: string]: unknown
};

export type FailedExecution = {
  arn: string
  reason: string
};

export type Pan = {
  uri: string
};
export type HandlerInput = {
  pdr: Pdr,
  running: string[],
  completed: string[],
  failed: FailedExecution[],
  [key: string]: unknown
};

export type HandlerOutput = {
  pdr: Pdr,
  pan: Pan,
  [key: string]: unknown
};
export type HandlerEvent = {
  config: {
    provider: {
      protocol: string,
      host: string,
    },
    remoteDir: string | null,
    panType: string | null
  },
  input: HandlerInput,
};
