const test = require('ava');
const moment = require('moment');
const { shouldBeCleanedUp, getInstancesToClean, terminateInstances } = require('..');

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
  process.env.timeout_key = 'Other Stuff';
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

  delete process.env.timeout_key;
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


test('getInstancesToClean returns a list of expired InstanceIds', async (t) => {
  const instances = await getInstancesToClean(
    () => ({
      Reservations: [
        {
          Instances: [
            {
              InstanceId: '1',
              Tags: [
                {
                  Key: 'Rotate By',
                  Value: '2001-03-05',
                },
                {
                  Key: 'abc',
                  Value: 'abcd',
                }
              ]
            },
            {
              InstanceId: '2',
              Tags: [
                {
                  Key: 'Rotate By',
                  Value: '2001-01-05',
                }
              ]
            }
          ]
        },
        {
          Instances: [
            {
              InstanceId: '3',
              Tags: []
            },
            {
              InstanceId: '4',
              Tags: [
                {
                  Key: 'Rotate By',
                  Value: '2001-01-05',
                }
              ]
            }
          ]
        }
      ]
    }),
    () => moment('2001-02-03')
  );
  t.deepEqual(instances, ['2', '4'])
});


test('getInstancesToClean gracefully handles mangled objects', async (t) => {
  const instances1 = await getInstancesToClean(
    () => ({
      abc: [
        {
          Instances: [
            {
              InstanceId: '1',
              Tags: [
                {
                  Key: 'Rotate By',
                  Value: '2001-03-05',
                },
                {
                  Key: 'abc',
                  Value: 'abcd',
                }
              ]
            },
            {
              InstanceId: '2',
              Tags: [
                {
                  Key: 'Rotate By',
                  Value: '2001-01-05',
                }
              ]
            }
          ]
        },
      ]
    }),
    () => moment('2001-02-03')
  );
  t.deepEqual(instances1, []);
  const instances2 = await getInstancesToClean(
    () => ({
      Reservations: [
        {
          acbc: [
            {
              InstanceId: '1',
              Tags: [
                {
                  Key: 'Rotate By',
                  Value: '2001-03-05',
                },
                {
                  Key: 'abc',
                  Value: 'abcd',
                }
              ]
            },
            {
              InstanceId: '2',
              Tags: [
                {
                  Key: 'Rotate By',
                  Value: '2001-01-05',
                }
              ]
            }
          ]
        },
      ]
    }),
    () => moment('2001-02-03')
  );
  t.deepEqual(instances2, [])
  const instances3 = await getInstancesToClean(
    () => ({
      Reservations: [
        {
          Instances: [
            {
              InstanceId: '1',
              Tags: [
                {
                  av: 'Rotate By',
                  Value: '2001-03-05',
                },
                {
                  Key: 'abc',
                  Value: 'abcd',
                }
              ]
            },
            {
              InstanceId: '2',
              Tags: [
                {
                  Key: 'Rotate By',
                  Value: '2001-01-05',
                }
              ]
            }
          ]
        },
      ]
    }),
    () => moment('2001-02-03')
  );
  t.deepEqual(instances3, ['2'])
});

test('terminateInstances runs on valid list of instanceIds', async (t) => {
  t.deepEqual(
    await terminateInstances([], () => {}),
    { statusCode: 200, message: 'termination completed with no instances out of date'}
  );
  t.like(
    await terminateInstances(['abc'], () => {}),
    { statusCode: 200 }
  );
})