const SuiteTimeReporter = () => {
  const suiteTimers = {};
  return {
    suiteStarted: (result) => {
      suiteTimers[result.description] = (new Date()).valueOf();
    },
    suiteDone: (result) => {
      const duration = (new Date()).valueOf() - suiteTimers[result.description];
      console.log(`\nsuiteDone: ${duration / 1000.0} secs "${result.description}"`);
    }
  };
};

const suiteTimeReporter = new SuiteTimeReporter();

jasmine.getEnv().addReporter(suiteTimeReporter);
