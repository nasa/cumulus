export interface HandlerInput {
  pdr: {
    name: string,
    path?: string,
  },
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
