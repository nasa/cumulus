import { ApiGranule } from '@cumulus/types/api/granules';

export type HandlerInput = {
  granules: ApiGranule[],
};

export type HandlerOutput = {
  granules: ApiGranule[],
};
export type HandlerEvent = {
  config?: {
    hashDepth?: string | number,
  },
  input: HandlerInput,
};
