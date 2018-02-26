'use strict';

const test = require('ava');
const RunGdalTask = require('../index');

test('mbr - crossing prime meridian', (t) => {
  const polyString = '-16.8145921 -17.582719 -16.803388 17.642083 -16.1463177 17.6533954 -16.15706 -17.57401 -16.8145921 -17.582719';
  const result = RunGdalTask.computeMbr(polyString);
  const expected = [-16.8145921, -17.582719, -16.1463177, 17.6533954];
  t.deepEqual(result, expected);
});

test('mbr - crossing anti-meridian', (t) => {
  const polyString = '-16.8145921 179.582719 -16.803388 -179.642083 -16.1463177 -179.6533954 -16.15706 179.57401 -16.8145921 179.582719';
  const result = RunGdalTask.computeMbr(polyString);
  const expected = [-16.8145921, 179.582719, -16.1463177, -179.6533954];
  t.deepEqual(result, expected);
});

test('mbr - neither crossing prime meridian nor anti-meridian', (t) => {
  const polyString = '-16.8145921 -17.582719 -16.803388 -7.642083 -16.1463177 -7.6533954 -16.15706 -17.57401 -16.8145921 -17.582719';
  const result = RunGdalTask.computeMbr(polyString);
  const expected = [-16.8145921, -17.582719, -16.1463177, -7.642083];
  t.deepEqual(result, expected);
});
