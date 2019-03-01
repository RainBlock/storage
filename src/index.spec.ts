import 'mocha';

import * as chai from 'chai';
// Needed for should.not.be.undefined.
/* tslint:disable:no-unused-expression */

chai.should();
const should = chai.should();


describe('Template test', () => {
  it('should do something', async () => {
    const zero = 0;
    zero.should.equal(0);
  });
});
