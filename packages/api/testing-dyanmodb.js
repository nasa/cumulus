// test creating a rule in dynamoDB

const manager = require('./models/base');
const models = require('./models');
const model = new models.Rule();
const tableName = 'rule';
model.tableName = tableName;
const ruleName = 'testRule';

// manager.createTable(tableName, {name: tableName, type: 'B'}).then((table) => {
//   const createResult = model.create({
//     name: ruleName,
//     workflow: 'test-workflow',
//     collection: {
//       name: 'test-collection',
//       version: '0.0.0'
//     },
//     rule: {
//       type: 'scheduled'
//     },
//     state: 'DISABLED',
//   });

//   return createResult.then((result) => {
//     console.log('result is: ');
//     console.log(result);
//     return model.get({name: ruleName}).then((isFound) => {
//       console.log('Rule is found: ' + isFound);
//     });
//   }).catch((err) => {
//     console.log(err);
//   });
// });
const createResult = model.create({
  name: ruleName,
  workflow: 'test-workflow',
  collection: {
    name: 'test-collection',
    version: '0.0.0'
  },
  rule: {
    type: 'scheduled'
  },
  state: 'DISABLED',
});

createResult.then((result) => {
  console.log('result is: ');
  console.log(result);
  return model.get({name: ruleName}).then((isFound) => {
    console.log('Rule is found: ' + isFound);
  });
}).catch((err) => {
  console.log(err);
});
