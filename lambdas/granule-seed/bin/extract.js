// @ts-check

'use strict';

const { parseExtractArgs } = require('../src/args');
const { extract } = require('../src/extract');

/**
 * @returns {Promise<void>}
 */
const main = async () => {
  const args = parseExtractArgs();

  if (args.help) {
    console.log(args.usage);
    return;
  }

  // Only under --local: the sibling scripts set this at module scope, which would silently
  // disable TLS against a real cluster.
  if (args.local) process.env.DISABLE_PG_SSL = 'true';

  const result = await extract(args);

  if (result.dryRun) {
    console.log(JSON.stringify(
      {
        dryRun: true,
        schemaFingerprint: result.fingerprint,
        source: result.sourceDescription,
        sampling: result.sampling,
        tiersToWrite: result.tiers.map((/** @type {any} */ t) => t.name),
      },
      undefined,
      2
    ));
    return;
  }

  console.log(JSON.stringify(
    {
      schemaFingerprint: result.fingerprint,
      tiers: result.tiers.map((/** @type {any} */ m) => ({
        tier: m.tier,
        granules: m.stats.granuleCount,
        files: m.stats.fileCount,
        filesPerGranule: Number(m.stats.filesPerGranule.toFixed(2)),
      })),
    },
    undefined,
    2
  ));
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`granule-seed extract failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
