// @ts-check

'use strict';

const { parseLoadArgs } = require('../src/args');
const { load } = require('../src/load');

/**
 * @returns {Promise<void>}
 */
const main = async () => {
  const args = parseLoadArgs();

  if (args.help) {
    console.log(args.usage);
    return;
  }

  if (args.local) process.env.DISABLE_PG_SSL = 'true';

  const result = await load(args);
  console.log(JSON.stringify(result, undefined, 2));
  if (!result.dryRun) {
    console.log('\nLoaded. To undo: node bin/revert.js '
      + `--bucket ${args.bucket} --prefix ${args.prefix} --load-id ${result.loadId}`);
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`granule-seed load failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
