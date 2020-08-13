function SuiteTimeReporter() {
  const suiteTimers = {};
  return {
    suiteStarted: (result) => {
      suiteTimers[result.description] = (new Date()).valueOf();
    },
    suiteDone: (result) => {
      const duration = (new Date()).valueOf() - suiteTimers[result.description];
      console.log(`\nsuiteDone: ${duration / 1000} secs "${result.description}" at ${new Date().toString()}`);
    },
  };
}

const suiteTimeReporter = new SuiteTimeReporter();

jasmine.getEnv().addReporter(suiteTimeReporter);
