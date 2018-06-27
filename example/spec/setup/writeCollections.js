const { addProviders, addCollections } = require('@cumulus/integration-tests');
const { loadConfig } = require('../helpers/testUtils');
const config = loadConfig();

const collectionsDirectory = './data/collections';

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
};

try {
  const repeatTimes = 10;
  const nCollections = 10*3;
  const waitTime = 1000;
  console.log(`Writing ${nCollections} collections every ${waitTime/1000} seconds for ${repeatTimes} iterations`);

  const runTest = async () => {
    await Array.from(Array(repeatTimes)).forEach(async () => {
      Array.from(Array(nCollections)).forEach(async () => {
        await addCollections(config.stackName, config.bucket, collectionsDirectory);
      });
      await timeout(waitTime);
    });
  }
  runTest();
}
catch (e) {
  console.log(e);
  throw e;
}
