// @ts-check

'use strict';

const { parseRevertArgs } = require('../src/args');
const { listLoads, revert } = require('../src/revert');

/**
 * @returns {Promise<void>}
 */
const main = async () => {
  const args = parseRevertArgs();

  if (args.help) {
    console.log(args.usage);
    return;
  }

  if (args.local) process.env.DISABLE_PG_SSL = 'true';

  if (args.list) {
    console.log(JSON.stringify(await listLoads(args), undefined, 2));
    return;
  }

  const deleted = await revert(args);
  console.log(JSON.stringify({ loadId: args.loadId, deleted }, undefined, 2));
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`granule-seed revert failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
