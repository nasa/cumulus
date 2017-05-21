'use strict';

const { Map, fromJS } = require('immutable');
const ws = require('../../app/scripts/reducers/workflow-status');
const { withNamedExamples } = require('../test-helper');
const chai = require('chai');
const chaiImmutable = require('chai-immutable');
chai.use(chaiImmutable);
const expect = chai.expect;

describe('sortWorkflows', () => {
  const workflows = [
    { name: 'alpha',
      success_ratio: { successes: 1, total: 1 },
      products:
      [{ last_execution: { success: true, stop_date: 6 } }] },

    { name: 'charlie',
      success_ratio: { successes: 2, total: 2 },
      products:
      [{ last_execution: { success: true, stop_date: 3 } },
       { last_execution: { success: true, stop_date: 4 } }] },

    { name: 'beta',
      success_ratio: { successes: 1, total: 1 },
      products: [{ last_execution: { success: true, stop_date: 4 } }] },

    { name: 'delta',
      success_ratio: { successes: 1, total: 1 },
      products:
      [{ last_execution: { success: true, stop_date: 7 } }] }
  ];

  const makeState = (field, ascending) =>
    fromJS({ workflows, sort: { ascending, field } });


  withNamedExamples(
    ([startField, startAsc, sortField], [expectedAsc, expectedOrder]) => {
      const state = makeState(startField, startAsc);
      const resultState = ws.sortWorkflows(state, sortField);
      const actualNames = resultState.get('workflows').map(w => w.get('name')).toJS();
      const expectedNames = expectedOrder.split(/\s*,\s*/);
      expect(actualNames).to.deep.equal(expectedNames);
      expect(resultState.get('sort')).to.equal(Map({ field: sortField, ascending: expectedAsc }));
    },
    // starting state                    Ending State
    'Name ascending',
    [ws.SORT_NONE, true, ws.SORT_NAME], [true, 'alpha, beta, charlie, delta'],

    'Name descending',
    [ws.SORT_NAME, true, ws.SORT_NAME], [false, 'delta, charlie, beta, alpha'],

    'Last completed ascending',
    [ws.SORT_NAME, true, ws.SORT_LAST_COMPLETED], [true, 'delta, alpha, beta, charlie'],

    'Last completed descending',
    [ws.SORT_LAST_COMPLETED, true, ws.SORT_LAST_COMPLETED],
    [false, 'charlie, beta, alpha, delta'],

    'Success Rate ascending',
    [ws.SORT_NAME, true, ws.SORT_RECENT_EXECUTIONS], [true, 'alpha, beta, delta, charlie'],

    'Success Rate descending',
    [ws.SORT_RECENT_EXECUTIONS, true, ws.SORT_RECENT_EXECUTIONS],
    [false, 'charlie, delta, beta, alpha'],

    'Num Running ascending',
    [ws.SORT_NAME, true, ws.SORT_NUM_RUNNING], [true, 'alpha, beta, charlie, delta'],
    'Num Running descending',
    [ws.SORT_NUM_RUNNING, true, ws.SORT_NUM_RUNNING], [false, 'delta, charlie, beta, alpha']

  );
});
