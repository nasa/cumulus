interface HandlerGranule {
  granuleId: string
}

interface HandlerEvent {
  input: {
    granules: HandlerGranule[]
  }
}

export const handler = (event: HandlerEvent) => {
  const granules = event.input.granules;

  return { granules };
};

// export const cmaHandler = (event, context) =>
//   runCumulusTask(handler, event, context);
