import test from 'ava';
import { handler } from '../src';

test('The handler returns the granules from its input', async (t) => {
  const event = {
    input: {
      granules: [
        { granuleId: 'g-1' },
        { granuleId: 'g-2' }
      ]
    }
  };

  const result = await handler(event);

  t.is(result.granules.length, 2);

  const granuleIds = result.granules.map((g) => g.granuleId);

  t.true(granuleIds.includes('g-1'));
  t.true(granuleIds.includes('g-2'));
});
