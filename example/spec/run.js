require('babel-register')({
  // Commented out because of https://github.com/babel/babel/issues/6130

  // This will override `node_modules` ignoring - you can alternatively pass
  // an array of strings to be explicitly matched or a regex / glob
  // ignore: false
});
const Jasmine = require('jasmine');

const jasmine = new Jasmine();
jasmine.loadConfigFile('spec/support/jasmine.json');
jasmine.execute();
