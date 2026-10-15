'use strict';

const test = require('ava');

const { planAllocation } = require('../src/sample');

/**
 * @param {number[]} counts
 * @returns {{collectionCumulusId: number, granuleCount: number}[]}
 */
const stats = (counts) =>
  counts.map((granuleCount, index) => ({
    collectionCumulusId: index + 1,
    granuleCount,
  }));

test('planAllocation hits the budget exactly when there is headroom', (t) => {
  const { allocations, total } = planAllocation({
    budget: 1000,
    collectionStats: stats([10_000, 5000, 1000]),
  });

  t.is(total, 1000);
  t.is(allocations.reduce((sum, a) => sum + a.granuleCount, 0), 1000);
});

test('planAllocation apportions roughly in proportion to collection size', (t) => {
  const { allocations } = planAllocation({
    budget: 1000,
    collectionStats: stats([8000, 2000]),
  });

  const byId = new Map(allocations.map((a) => [a.collectionCumulusId, a.granuleCount]));
  // 80/20 split, allowing for the remainder pass closing the gap on the larger one.
  t.true(byId.get(1) >= 780 && byId.get(1) <= 820, `got ${byId.get(1)}`);
  t.true(byId.get(2) >= 180 && byId.get(2) <= 220, `got ${byId.get(2)}`);
});

test('planAllocation gives every collection at least the floor', (t) => {
  const { allocations } = planAllocation({
    budget: 1000,
    collectionStats: stats([100_000, 100_000, 3]),
    floor: 3,
  });

  const smallest = allocations.find((a) => a.collectionCumulusId === 3);
  t.is(smallest.granuleCount, 3, 'a tiny collection still appears');
});

test('planAllocation never allocates more than a collection holds', (t) => {
  const collectionStats = stats([5, 7, 11]);
  const { allocations, total } = planAllocation({ budget: 1000, collectionStats });

  allocations.forEach((allocation) => {
    const available = collectionStats
      .find((s) => s.collectionCumulusId === allocation.collectionCumulusId).granuleCount;
    t.true(
      allocation.granuleCount <= available,
      `collection ${allocation.collectionCumulusId}: `
        + `${allocation.granuleCount} > ${available}`
    );
  });

  t.is(total, 23, 'clamps to everything the source has');
});

test('planAllocation spans several collections even at the smallest tier', (t) => {
  const { allocations, total } = planAllocation({
    budget: 10,
    collectionStats: stats([100_000, 50_000, 20_000, 1000]),
  });

  t.is(total, 10);
  t.true(allocations.length > 1, 'a 10-granule tier is not confined to one collection');
});

test('planAllocation samples the largest collections when the budget is small', (t) => {
  // 20 collections, budget 5: take the five largest, one granule each.
  const collectionStats = stats([...Array.from({ length: 20 }, (_, i) => (i + 1) * 100)]);
  const { allocations, total } = planAllocation({ budget: 5, collectionStats });

  t.is(total, 5);
  t.deepEqual(allocations.map((a) => a.collectionCumulusId), [16, 17, 18, 19, 20]);
  allocations.forEach((a) => t.is(a.granuleCount, 1));
});

test('planAllocation rejects a non-positive budget', (t) => {
  t.throws(() => planAllocation({ budget: 0, collectionStats: stats([10]) }), {
    message: /budget must be positive/,
  });
});

test('planAllocation rejects a source with no granules', (t) => {
  t.throws(() => planAllocation({ budget: 10, collectionStats: stats([0, 0]) }), {
    message: /no granules to sample/,
  });
});

test('planAllocation returns allocations ordered by collection id', (t) => {
  const { allocations } = planAllocation({
    budget: 900,
    collectionStats: stats([1000, 9000, 5000]),
  });

  const ids = allocations.map((a) => a.collectionCumulusId);
  t.deepEqual(ids, [...ids].sort((a, b) => a - b));
});
