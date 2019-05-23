
var reporters = require('jasmine-reporters');
var junitReporter = new reporters.JUnitXmlReporter({
    savePath: process.env.JUNIT_DIR || '/tmp',
    consolidateAll: false
});
jasmine.getEnv().addReporter(junitReporter)