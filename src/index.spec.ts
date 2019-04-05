import 'mocha';

import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, HashType} from 'bigint-hash';
import * as chai from 'chai';
import * as path from 'path';
import {RlpDecode, RlpDecoderTransform, RlpList} from 'rlp-stream';
import {Readable} from 'stream';


declare var process: {browser: boolean;};
const should = chai.should();
chai.should();

const assertEquals = (n0: BigInt, n1: BigInt) => {
  n0.toString(16).should.equal(n1.toString(16));
};

describe('Basic Test', async () => {
  it('test', async () => {
    const zero = 0n;
    assertEquals(zero, BigInt(0));
  });
});
