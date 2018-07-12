const { loadConfig } = require('../helpers/testUtils');
const { deleteTestStream } = require('../helpers/kinesisHelpers');
const config = loadConfig();

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;


describe('Cleans up Test Resources', () => {
  it('Closes a kinesis test stream.', async () => {
    await deleteTestStream(config.streamName);
  });
});
