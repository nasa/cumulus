'use strict';

import { Map, fromJS } from 'immutable';
const ws = require('../../app/scripts/reducers/workflow-status');
const { withNamedExamples } = require('../test-helper');
const chai = require('chai');
const chaiImmutable = require('chai-immutable');
chai.use(chaiImmutable);
const expect = chai.expect;

describe('sortWorkflows', () => {
  const workflows = [
    { name: 'alpha',
      executions:
      [{ status: 'SUCCEEDED', stop_date: 6 }] },

    { name: 'charlie',
      executions:
      [{ status: 'SUCCEEDED', stop_date: 4 },
       { status: 'SUCCEEDED' },
       { status: 'RUNNING' }] },

    { name: 'beta',
      executions: [{ status: 'SUCCEEDED', stop_date: 4 }] },

    { name: 'delta',
      executions:
      [{ status: 'SUCCEEDED', stop_date: 7 },
       { status: 'RUNNING' },
       { status: 'RUNNING' }] }
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
    [ws.SORT_NAME, true, ws.SORT_SUCCESS_RATE], [true, 'alpha, beta, delta, charlie'],
    'Success Rate descending',
    [ws.SORT_SUCCESS_RATE, true, ws.SORT_SUCCESS_RATE], [false, 'charlie, delta, beta, alpha'],

    'Num Running ascending',
    [ws.SORT_NAME, true, ws.SORT_NUM_RUNNING], [true, 'alpha, beta, charlie, delta'],
    'Num Running descending',
    [ws.SORT_NUM_RUNNING, true, ws.SORT_NUM_RUNNING], [false, 'delta, charlie, beta, alpha']

  );
});
