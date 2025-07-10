const test = require('ava');
const moment = require('moment');
const { shouldBeCleanedUp, handler } = require('..')

test('shouldBeCleanedUp returns false if date is not passed', (t) => {
  t.false(shouldBeCleanedUp(
    {
      Tags: [
        {
          Key: 'Rotate By',
          Value: '2001-02-23',
        },
      ],
    },
    () => moment('2001-02-03')
  ));
  t.false(shouldBeCleanedUp(
    {
      Tags: [
        {
          Key: 'Rotate By',
          Value: '2001-02-23',
        },
        {
          Key: 'Other Stuff',
          Value: '2001-02-01',
        },
      ],
    },
    () => moment('2001-02-03')
  ));
});

test.serial('shouldBeCleanedUp respects "timeout_key" variable', (t) => {
  t.false(shouldBeCleanedUp(
    {
      Tags: [
        {
          Key: 'Rotate By',
          Value: '2001-02-23',
        },
      ],
    },
    () => moment('2001-02-03')
  ));
  process.env['timeout_key'] = 'Other Stuff';
  t.true(shouldBeCleanedUp(
    {
      Tags: [
        {
          Key: 'Rotate By',
          Value: '2001-02-23',
        },
        {
          Key: 'Other Stuff',
          Value: '2001-02-01',
        },
      ],
    },
    () => moment('2001-02-03')
  ));

  delete process.env['timeout_key'];
});

test('shouldBeCleanedUp returns true if date is passed', (t) => {
  t.true(shouldBeCleanedUp(
    {
      Tags: [
        {
          Key: 'Rotate By',
          Value: '2001-02-23',
        },
      ],
    },
    () => moment('2001-05-03')
  ));
  t.true(shouldBeCleanedUp(
    {
      Tags: [
        {
          Key: 'Rotate By',
          Value: '2001-02-23',
        },
        {
          Key: 'Other Stuff',
          Value: '2001-02-01',
        },
      ],
    },
    () => moment('2001-05-03')
  ));
});

test('shouldBeCleanedUp returns false if there is no expiration date key', (t) => {
  t.false(shouldBeCleanedUp(
    {
      Tags: [
      ],
    },
    () => moment('2001-02-03')
  ));
  t.false(shouldBeCleanedUp(
    {
      Tags: [
        {
          Key: 'Other Stuff',
          Value: '2001-02-01',
        },
      ],
    },
    () => moment('2001-02-03')
  ));
});
