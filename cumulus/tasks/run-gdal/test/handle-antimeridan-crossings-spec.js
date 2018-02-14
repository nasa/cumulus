'use strict';

const test = require('ava');
const RunGdalTask = require('../index');

test('mbr - crossing prime meridian', (t) => {
  const polyString = '-16.8145921 -17.582719 -16.803388 17.642083 -16.1463177 17.6533954 -16.15706 -17.57401 -16.8145921 -17.582719';
  const result = RunGdalTask.mbr(polyString);
  const expected = [-16.8145921, -17.582719, -16.1463177, 17.6533954];
  t.deepEqual(result, expected);
});

test('mbr - crossing anti-meridian', (t) => {
  const polyString = '-16.8145921 179.582719 -16.803388 -179.642083 -16.1463177 -179.6533954 -16.15706 179.57401 -16.8145921 179.582719';
  const result = RunGdalTask.mbr(polyString);
  const expected = [-16.8145921, 179.582719, -16.1463177, -179.6533954];
  t.deepEqual(result, expected);
});

test('mbr - neither crossing prime meridian nor anti-meridian', (t) => {
  const polyString = '-16.8145921 -17.582719 -16.803388 -7.642083 -16.1463177 -7.6533954 -16.15706 -17.57401 -16.8145921 -17.582719';
  const result = RunGdalTask.mbr(polyString);
  const expected = [-16.8145921, -17.582719, -16.1463177, -7.642083];
  t.deepEqual(result, expected);
});

// small rectangle crossing the anti-meridian
test('does cross antimeridian - affirmative', (t) => {
  const polyString = '-16.8145921 179.582719 -16.803388 -179.642083 -16.1463177 -179.6533954 -16.15706 179.57401 -16.8145921 179.582719';
  const result = RunGdalTask.doesCrossAntimeridian(polyString);
  t.is(result, true);
});

// same points as above, but representing the big rectangle that does NOT cross the anti-meridian
// test('does cross antimeridian - negative', (t) => {
//   const polyString = '-16.803388 -179.642083 -16.8145921 179.582719 -16.15706 179.57401 -16.1463177 -179.6533954 -16.803388 -179.642083';
//   const result = RunGdalTask.doesCrossAntimeridian(polyString);
//   t.is(result, false);
// });

// test('split polygon at antimeridian crossing', (t) => {
//   const polyString = '-16.8145921 179.582719 -16.803388 -179.642083 -16.1463177 -179.6533954 -16.15706 179.57401 -16.8145921 179.582719';
//   const result = RunGdalTask.splitPolygonAtAntimeridian(polyString);
//   t.is(result, [[179.57401, -16.1463177], [179.999, -16.1463177], [179.999, -16.8145921], [179.57401, -16.8145921], [179.57401, -16.1463177]],
//                 [[180.001, -16.1463177], [180.357917, -16.1463177], [180.357917, -16.8145921], [180.001, -16.8145921], [180.001, -16.1463177]]);
// });
