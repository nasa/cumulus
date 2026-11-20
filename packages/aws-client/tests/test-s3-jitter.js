'use strict';

const test = require('ava');

const { applyS3Jitter } = require('../s3-jitter');

test('applyS3Jitter does not throw when maxJitterMs is 0', async (t) => {
  await t.notThrowsAsync(async () => {
    await applyS3Jitter(0);
  });
});

test('applyS3Jitter does not throw when maxJitterMs is negative', async (t) => {
  await t.notThrowsAsync(async () => {
    await applyS3Jitter(-100);
  });
});

test('applyS3Jitter applies positive delay when requested', async (t) => {
  const maxJitterMs = 100;
  const iterations = 5;

  const durations = await Promise.all(
    Array.from({ length: iterations }, async () => {
      const startTime = Date.now();
      await applyS3Jitter(maxJitterMs);
      return Date.now() - startTime;
    })
  );

  const hasDelay = durations.some((d) => d > 0);
  t.true(hasDelay, 'At least one call should demonstrate delay from setTimeout');
});

test('applyS3Jitter respects maximum jitter bound', async (t) => {
  const maxJitterMs = 100;
  const iterations = 10;

  const durations = await Promise.all(
    Array.from({ length: iterations }, async () => {
      const startTime = Date.now();
      await applyS3Jitter(maxJitterMs);
      return Date.now() - startTime;
    })
  );

  // proportional bound (2x overhead) instead of fixed margin
  const maxAllowed = maxJitterMs * 2;
  durations.forEach((duration, index) => {
    t.true(
      duration <= maxAllowed,
      `Iteration ${index}: Duration ${duration}ms should not exceed ${maxAllowed}ms (2x buffer)`
    );
  });
});

test('applyS3Jitter produces varied delays', async (t) => {
  const maxJitterMs = 500;
  const iterations = 10;

  const durations = await Promise.all(
    Array.from({ length: iterations }, async () => {
      const startTime = Date.now();
      await applyS3Jitter(maxJitterMs);
      return Date.now() - startTime;
    })
  );

  // Count how many are in different ranges
  const minDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);
  const range = maxDuration - minDuration;

  // 10 iterations of random 0-500ms, we should see variety
  t.true(range > 0, 'Should see variation across multiple calls to random jitter');
});

test('applyS3Jitter accepts operation parameter', async (t) => {
  await t.notThrowsAsync(async () => {
    await applyS3Jitter(50, 'testOperation');
  });
});

test('applyS3Jitter works without operation parameter', async (t) => {
  await t.notThrowsAsync(async () => {
    await applyS3Jitter(50);
  });
});
