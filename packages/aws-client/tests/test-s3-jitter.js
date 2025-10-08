'use strict';

const test = require('ava');

const { applyS3Jitter } = require('../s3-jitter');

test('applyS3Jitter does not delay when maxJitterMs is 0', async (t) => {
  const startTime = Date.now();
  await applyS3Jitter(0);
  const duration = Date.now() - startTime;

  // Should complete almost immediately (allow 10ms for test overhead)
  t.true(duration < 10, `Expected < 10ms, got ${duration}ms`);
});

test('applyS3Jitter does not delay when maxJitterMs is negative', async (t) => {
  const startTime = Date.now();
  await applyS3Jitter(-100);
  const duration = Date.now() - startTime;

  // Should complete almost immediately
  t.true(duration < 10, `Expected < 10ms, got ${duration}ms`);
});

test('applyS3Jitter applies random delay within range', async (t) => {
  const maxJitterMs = 100;
  const startTime = Date.now();
  await applyS3Jitter(maxJitterMs);
  const duration = Date.now() - startTime;

  // Duration should be between 0 and maxJitterMs (allow 20ms overhead)
  t.true(duration >= 0, `Expected >= 0ms, got ${duration}ms`);
  t.true(duration <= maxJitterMs + 20, `Expected <= ${maxJitterMs + 20}ms, got ${duration}ms`);
});

test('applyS3Jitter accepts operation parameter', async (t) => {
  const maxJitterMs = 50;
  const operation = 'testOperation';

  // Should not throw with operation parameter
  await t.notThrowsAsync(async () => {
    await applyS3Jitter(maxJitterMs, operation);
  });
});

test('applyS3Jitter works without operation parameter', async (t) => {
  const maxJitterMs = 50;

  // Should not throw without operation parameter
  await t.notThrowsAsync(async () => {
    await applyS3Jitter(maxJitterMs);
  });
});

test('applyS3Jitter applies different random values on multiple calls', async (t) => {
  const maxJitterMs = 1000;
  const iterations = 10;

  // Run all jitter calls in parallel
  const durationPromises = Array.from({ length: iterations }, async () => {
    const startTime = Date.now();
    await applyS3Jitter(maxJitterMs);
    return Date.now() - startTime;
  });

  const durations = await Promise.all(durationPromises);

  // Check that we got different values (at least some variation)
  const uniqueDurations = new Set(durations);
  t.true(
    uniqueDurations.size > 1,
    `Expected multiple different durations, got ${uniqueDurations.size} unique values`
  );

  // All should be within the valid range
  durations.forEach((duration) => {
    t.true(duration <= maxJitterMs + 20, `Duration ${duration}ms exceeded max ${maxJitterMs}ms`);
  });
});

test('applyS3Jitter respects upper bound', async (t) => {
  const maxJitterMs = 100;
  const iterations = 20;

  // Run all jitter calls in parallel and check each duration
  const durationPromises = Array.from({ length: iterations }, async (_, index) => {
    const startTime = Date.now();
    await applyS3Jitter(maxJitterMs);
    const duration = Date.now() - startTime;

    // Should never exceed maxJitterMs (allow 20ms for overhead)
    t.true(
      duration <= maxJitterMs + 20,
      `Iteration ${index}: Duration ${duration}ms exceeded max ${maxJitterMs}ms`
    );
  });

  await Promise.all(durationPromises);
  t.pass();
});
