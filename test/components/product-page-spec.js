'use strict';

const { parsePathIds } = require('../../app/scripts/components/product-page');
const chai = require('chai');
const expect = chai.expect;

describe('parsePathIds', () => {
  it('should work', () => {
    const props = { location: { pathname: '/workflows/IngestVIIRS/products/VNGCR_LQD_C1' } };
    expect(parsePathIds(props)).to.deep.equal({
      workflowId: 'IngestVIIRS',
      productId: 'VNGCR_LQD_C1'
    });
  });
});

