import 'mocha';

import {toBufferBE} from 'bigint-buffer';
import * as chai from 'chai';
import * as path from 'path';
import {RlpDecode, RlpDecoderTransform, RlpList} from 'rlp-stream';
import {Readable} from 'stream';

import {StorageNode} from './index';
import {computeBlockHash, ethereumAccountToRlp, rlpToEthereumAccount} from './utils';

const asyncChunks = require('async-chunks');
const fs = process.browser ? undefined : require('fs-extra');
const get = process.browser ? require('simple-get') : undefined;
const ethjsBlock = require('ethereumjs-block');

declare var process: {browser: boolean;};
chai.should();

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

describe('Test utility functions', async () => {
  const rlpBlocks: RlpList[] = [];

  before(async () => {
    for await (const chunk of asyncChunks(await loadStream(BLOCK_FIRST10))) {
      rlpBlocks.push(chunk);
    }
  });

  it('ComputeBlockHash: should compute correct block hash', async () => {
    for (let i = 0; i < rlpBlocks.length; i++) {
      const ethBlock = new ethjsBlock(rlpBlocks[i]);
      const hash = toBufferBE(computeBlockHash(rlpBlocks[i]), 32);
      hash.should.deep.equal(ethBlock.hash());
    }
  });

  it('should rlpEncode and rlpDecode EthereumAccount correctly', async () => {
    const snode = new StorageNode(-1);
    const key = Buffer.from('000d836201318ec6899a67540690382780743280', 'hex');
    const accountVal = snode.get(key).value;
    const rlpAccount = RlpDecode(accountVal!) as RlpList;
    const ethAccount = rlpToEthereumAccount(rlpAccount);
    const decodedVal = ethereumAccountToRlp(ethAccount);
    decodedVal.should.deep.equal(accountVal);
  });
});
