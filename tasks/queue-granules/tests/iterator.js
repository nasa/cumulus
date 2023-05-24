'use strict';

const test = require('ava');
const { GroupedGranulesIterable } = require('..');

function createGranule(granuleId, dataType, version, provider = undefined) {
  return {
    granuleId,
    dataType,
    version,
    files: [],
    ...(provider ? { provider } : {}),
  };
}

test('GroupedGranulesIterable yields all granules', (t) => {
  const granule1 = createGranule('granule-1', 'collection-1', '001');
  const granule2 = createGranule('granule-2', 'collection-1', '001');
  const granule3 = createGranule('granule-3', 'collection-1', '001');
  const iterable = new GroupedGranulesIterable([granule1, granule2, granule3], 3);
  t.deepEqual([...iterable].flatMap(({ chunks }) => [...chunks]), [[granule1, granule2, granule3]]);
});

test('GroupedGranulesIterable handles NaN chunkSize', (t) => {
  const granule1 = createGranule('granule-1', 'collection-1', '001');
  const granule2 = createGranule('granule-2', 'collection-1', '001');
  const granule3 = createGranule('granule-3', 'collection-1', '001');
  const iterable = new GroupedGranulesIterable([granule1, granule2, granule3], Number.NaN);
  t.deepEqual([...iterable].flatMap(({ chunks }) => [...chunks]), [[granule1, granule2, granule3]]);
});

test('GroupedGranulesIterable batches granules by chunk size', (t) => {
  const granule1 = createGranule('granule-1', 'collection-1', '001');
  const granule2 = createGranule('granule-2', 'collection-1', '001');
  const granule3 = createGranule('granule-3', 'collection-1', '001');
  const iterable = new GroupedGranulesIterable([granule1, granule2, granule3], 1);
  t.deepEqual(
    [...iterable].flatMap(({ chunks }) => [...chunks]),
    [[granule1], [granule2], [granule3]]
  );
});

test('GroupedGranulesIterable batches granules by collection', (t) => {
  const granule1 = createGranule('granule-1', 'collection-1', '001');
  const granule2 = createGranule('granule-2', 'collection-2', '001');
  const granule3 = createGranule('granule-3', 'collection-1', '001');
  const iterable = new GroupedGranulesIterable([granule1, granule2, granule3], 3);
  t.deepEqual(
    [...iterable].flatMap(({ chunks }) => [...chunks]),
    [[granule1, granule3], [granule2]]
  );
});

test('GroupedGranulesIterable batches granules by version', (t) => {
  const granule1 = createGranule('granule-1', 'collection-1', '002');
  const granule2 = createGranule('granule-2', 'collection-1', '001');
  const granule3 = createGranule('granule-3', 'collection-1', '001');
  const iterable = new GroupedGranulesIterable([granule1, granule2, granule3], 3);
  t.deepEqual(
    [...iterable].flatMap(({ chunks }) => [...chunks]),
    [[granule1], [granule2, granule3]]
  );
});

test('GroupedGranulesIterable batches granules by collection and version', (t) => {
  const granule1 = createGranule('granule-1', 'collection-1', '001');
  const granule2 = createGranule('granule-2', 'collection-2', '001');
  const granule3 = createGranule('granule-3', 'collection-1', '002');
  const iterable = new GroupedGranulesIterable([granule1, granule2, granule3], 3);
  t.deepEqual(
    [...iterable].flatMap(({ chunks }) => [...chunks]),
    [[granule1], [granule2], [granule3]]
  );
});

test('GroupedGranulesIterable batches granules by provider', (t) => {
  const granule1 = createGranule('granule-1', 'collection-1', '001', 'test_provider');
  const granule2 = createGranule('granule-2', 'collection-1', '001', 'test_provider');
  const granule3 = createGranule('granule-3', 'collection-1', '001');
  const iterable = new GroupedGranulesIterable([granule1, granule2, granule3], 3);
  t.deepEqual(
    [...iterable].flatMap(({ chunks }) => [...chunks]),
    [[granule1, granule2], [granule3]]
  );
});
