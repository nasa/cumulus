const { Manager, Rule } = require('../models');

async function run(_options) {
  const rule = new Rule();
  const manager = new Manager({
    tableName: process.env.RulesTable,
    tableHash: { name: 'name', type: 'S' },
  });

  const queryNames = { '#tp': 'type', '#rl': 'rule' };
  const queryValues = { ':tp': 'kinesis' };
  const filter = '#rl.#tp = :tp';
  const response = await rule.scan({
    names: queryNames,
    values: queryValues,
    filter: filter,
  });
  const updateItems = response.Items.filter((item) => !item.rule.logEventArn);

  const updatePromises = updateItems.map((item) => rule.addKinesisEventSource(item,
    {
      name: process.env.KinesisInboundEventLogger,
      eventType: 'logEventArn',
    }));

  const updateMappings = await Promise.all(updatePromises);

  for (let i = 0; i < updateItems.length; i += 1) {
    updateItems[i].rule.logEventArn = updateMappings[i].UUID;
  }

  const updateItemPromises = updateItems.map((item) => manager.create(item));
  return Promise.all(updateItemPromises);
}

module.exports.name = 'migration_4';
module.exports.run = run;
