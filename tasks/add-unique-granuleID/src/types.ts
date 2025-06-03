// Either collectionId OR (datatype AND version) must be present
export type GranuleInput =
  | (BaseGranule & { collectionId: string; dataType: never; version: never })
  | (BaseGranule & { collectionId: never; dataType: string; version: string });

export type GranuleOutput =
  | (BaseGranule & { producerGranuleId: string } & {
    collectionId: string;
    dataType: never;
    version: never;
  })
  | (BaseGranule & { producerGranuleId: string } & {
    collectionId: never;
    dataType: string;
    version: string;
  });

interface BaseGranule {
  granuleId: string;
  producerGranuleId?: string;
}

export type HandlerInput = {
  granules: GranuleInput[],
};

export type HandlerOutput = {
  granules: GranuleOutput[],
};
export type HandlerEvent = {
  config?: {
    hashLength?: string | number,
  },
  input: HandlerInput,
};
