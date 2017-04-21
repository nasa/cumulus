'use strict';

import { Map } from 'immutable';
import { reducer } from '../app/scripts/api-health.js';
const chai = require('chai');
const chaiImmutable = require('chai-immutable');
chai.use(chaiImmutable);
const expect = chai.expect;

describe('api health reducer', () => {
  it('should handle API_HEALTH_IN_FLIGHT', () => {
    let state = reducer(Map({ inFlight:false }),  { type:'API_HEALTH_IN_FLIGHT' });
    expect(state).to.equal(Map({ inFlight:true }));
  });

  it('should handle API_HEALTH_RCVD', () => {
    let state = reducer(Map({ inFlight:true }),  { type:'API_HEALTH_RCVD', healthy:true });
    expect(state).to.equal(Map({ healthy:true, inFlight:false, error: undefined }));
  });
});
