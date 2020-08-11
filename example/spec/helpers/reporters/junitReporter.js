const reporters = require('jasmine-reporters');
const junitReporter = new reporters.JUnitXmlReporter({
  savePath: process.env.JUNIT_DIR || '/tmp',
  consolidateAll: false,
});
jasmine.getEnv().addReporter(junitReporter);
