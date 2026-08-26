/**
 * Run one dispatcher tick from the terminal.
 *
 *   npm run tick
 *
 * Useful for watching a scheduled post go out without waiting for the external
 * cron, and for seeing Instagram advance one container step at a time.
 */
async function main() {
  const { runTick } = await import("../src/lib/dispatcher");
  const started = Date.now();
  const result = await runTick(25);

  console.log(`tick finished in ${Date.now() - started}ms`);
  console.table({
    claimed: result.claimed,
    published: result.published,
    pending: result.pending,
    failed: result.failed,
    needsAuth: result.needsAuth,
  });

  if (result.errors.length > 0) {
    console.error("errors:");
    for (const error of result.errors) console.error(`  ${error}`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
