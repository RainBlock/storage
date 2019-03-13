import 'mocha';

import {decodeBlock, EthereumBlock} from '@rainblock/ethereum-block';
import {toBufferBE} from 'bigint-buffer';
import * as chai from 'chai';
import * as path from 'path';
import {RlpDecoderTransform, RlpList} from 'rlp-stream';
import {Readable} from 'stream';

import {computeBlockHash, StorageNode} from './index';

const asyncChunks = require('async-chunks');
const fs = process.browser ? undefined : require('fs-extra');
const get = process.browser ? require('simple-get') : undefined;
const ethjsBlock = require('ethereumjs-block');

declare var process: {browser: boolean;};
chai.should();

describe('Template test', () => {
  it('should do something', async () => {
    const zero = 0;
    zero.should.equal(0);
  });
});

const GENESIS_BLOCK = 'test_data/genesis.bin';
const BLOCK_FIRST10 = 'test_data/first10.bin';

const loadStream = async (filename: string) => {
  const decoder = new RlpDecoderTransform();
  if (process.browser) {
    return await new Promise((resolve, reject) => {
      try {
        get(`base/src/${filename}`, (err: string, result: Readable) => {
          if (err) {
            reject(err);
          } else {
            resolve(result.pipe(decoder));
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  } else {
    fs.createReadStream(path.join(__dirname, filename)).pipe(decoder);
    return decoder;
  }
};

const assertEquals = (n0: BigInt, n1: BigInt) => {
  n0.toString(16).should.equal(n1.toString(16));
};

describe('Genesis block', async () => {
  let block: EthereumBlock;
  let rlpBlock: RlpList;

  before(async () => {
    rlpBlock =
        (await asyncChunks(await loadStream(GENESIS_BLOCK)).next()).value;
    block = decodeBlock(rlpBlock);
  });

  it('should compute correct block hash', async () => {
    const ethBlock = new ethjsBlock(rlpBlock);
    const hash = toBufferBE(computeBlockHash(rlpBlock), 32);
    hash.should.deep.equal(ethBlock.hash());
  });

  it('should putGenesis', async () => {
    const snode = new StorageNode(-1);
  });
});

describe('First 10 blocks', async () => {
  const blocks: EthereumBlock[] = [];
  const rlpBlocks: RlpList[] = [];

  before(async () => {
    for await (const chunk of asyncChunks(await loadStream(BLOCK_FIRST10))) {
      blocks.push(decodeBlock(chunk));
      rlpBlocks.push(chunk);
    }
  });

  it('should compute correct block hash', async () => {
    const snode = new StorageNode(-1);
    for (let i = 0; i < blocks.length; i++) {
      const ethBlock = new ethjsBlock(rlpBlocks[i]);
      const hash = toBufferBE(computeBlockHash(rlpBlocks[i]), 32);
      hash.should.deep.equal(ethBlock.hash());
      if (i !== 0) {
        snode.update(rlpBlocks[i], [], []);
      }
    }
  });
});