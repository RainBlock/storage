import 'mocha';

import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, HashType} from 'bigint-hash';
import * as chai from 'chai';
import * as path from 'path';
import {RlpDecode, RlpDecoderTransform, RlpList} from 'rlp-stream';
import {Readable} from 'stream';

import {StorageNode} from './index';
import {computeBlockHash, ethereumAccountToRlp, rlpToEthereumAccount, UpdateOps} from './utils';

const asyncChunks = require('async-chunks');
const fs = process.browser ? undefined : require('fs-extra');
const get = process.browser ? require('simple-get') : undefined;
const ethjsBlock = require('ethereumjs-block');

declare var process: {browser: boolean;};
const should = chai.should();
chai.should();

const BLOCK_FIRST10 = 'test_data/first10.bin';
const snode = new StorageNode(-1);

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

describe('Utility functions', async () => {
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
    const account =
        Buffer.from('000d836201318ec6899a67540690382780743280', 'hex');
    const getAcc = await snode.get(account);
    if (!getAcc) {
      throw new Error('Null Response');
    }
    const accountVal = getAcc.value;
    const rlpAccount = RlpDecode(accountVal!) as RlpList;
    const ethAccount = rlpToEthereumAccount(rlpAccount);
    const decodedVal = ethereumAccountToRlp(ethAccount);
    decodedVal.should.deep.equal(accountVal);
  });
});

describe('Load Genesis', async () => {
  it('Loading Genesis block, state roots should match', async () => {
    const genesisRoot = Buffer.from(
        'd7f8974fb5ac78d9ac099b9ad5018bedc2ce0a72dad1827a1709da30580f0544',
        'hex');
    const state = snode._activeSnapshots.get(BigInt(0))[0];
    state.root.should.deep.equal(genesisRoot);
  });

  it('Internal data structures should be consistent', async () => {
    should.exist(snode._activeSnapshots.has(BigInt(0)));
    should.exist(snode._blockNumberToHash.has(BigInt(0)));
    const genesisHash = snode._blockNumberToHash.get(BigInt(0))[0];
    should.exist(snode._blockchain.has(genesisHash));
    snode._shard.should.equal(-1);
    assertEquals(snode._lowestBlockNumber, snode._highestBlockNumber);
  });
});

describe('Client <-> storage functions', async () => {
  it('GetAccount: existing account', async () => {
    const account =
        Buffer.from('000d836201318ec6899a67540690382780743280', 'hex');
    const balance = BigInt(200000000000000000000);
    const nonce = BigInt(0);
    const codeHash = BigInt(
        '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    const storageRoot = BigInt(
        '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421');
    const getAcc = await snode.get(account);
    if (!getAcc) {
      throw new Error('Null Response');
    }
    const accountVal = getAcc.value;
    const rlpAccount = RlpDecode(accountVal!) as RlpList;
    const ethAccount = rlpToEthereumAccount(rlpAccount);
    assertEquals(ethAccount.nonce, nonce);
    assertEquals(ethAccount.balance, balance);
    assertEquals(ethAccount.codeHash, codeHash);
    assertEquals(ethAccount.storageRoot, storageRoot);
  });

  it('GetAccount: non-existing account', async () => {
    const account =
        Buffer.from('000abcdefabcdefabcdef0001234567890abcdef', 'hex');
    const getAcc = await snode.get(account);
    if (!getAcc) {
      throw new Error('Null Response');
    }
    const accountVal = getAcc.value;
    should.not.exist(accountVal);
  });

  it('GetCode: existing account', async () => {
    const account =
        Buffer.from('000d836201318ec6899a67540690382780743280', 'hex');
    const codeHash = BigInt(
        '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');

    let codeAndAccount = await snode.getCode(account, true);
    if (!codeAndAccount) {
      throw new Error('Null Response');
    }
    const code = codeAndAccount.code;
    const calCodeHash = hashAsBigInt(HashType.KECCAK256, code!);
    assertEquals(calCodeHash, codeHash);
    should.not.exist(codeAndAccount.account);

    codeAndAccount = await snode.getCode(account, false);
    if (!codeAndAccount) {
      throw new Error('Null Response');
    }
    should.exist(codeAndAccount.account);
    should.exist(codeAndAccount.code);
  });

  it('GetCode: non existing account', async () => {
    const account =
        Buffer.from('000abcdefabcdefabcdef0001234567890abcdef', 'hex');
    let codeAndAccount = await snode.getCode(account, false);
    if (!codeAndAccount) {
      throw new Error('Null Response');
    }
    should.not.exist(codeAndAccount.account!.value);
    should.not.exist(codeAndAccount.code);

    codeAndAccount = await snode.getCode(account, true);
    if (!codeAndAccount) {
      throw new Error('Null Response');
    }
    should.not.exist(codeAndAccount.account);
    should.not.exist(codeAndAccount.code);
  });

  it('GetStorage: non existing account', async () => {
    const account =
        Buffer.from('000abcdefabcdefabcdef0001234567890abcdef', 'hex');
    const storage = await snode.getStorage(account, toBigIntBE(account));
    should.not.exist(storage);
  });

  it('GetStorage: existing account but non existing storage', async () => {
    const account =
        Buffer.from('000d836201318ec6899a67540690382780743280', 'hex');
    const storage = await snode.getStorage(account, toBigIntBE(account));
    if (!storage) {
      throw new Error('Null Response');
    }
    should.not.exist(storage!.value);
  });

  it('GetBlockHash: non existing block', async () => {
    const blockInValid = await snode.getBlockHash(BigInt(1));
    should.exist(blockInValid);
    if (!blockInValid) {
      throw new Error('Null Response');
    }
    blockInValid.length.should.equal(0);
  });

  it('GetRecentBlocks and GetBlockHash', async () => {
    const recentBlocks = await snode.getRecentBlocks();
    if (!recentBlocks) {
      throw new Error('Null Response');
    }
    assertEquals(BigInt(recentBlocks.length), BigInt(1));
    const blocks = await snode.getBlockHash(BigInt(0));
    if (!blocks) {
      throw new Error('Null Response');
    }
    blocks.should.deep.equal(recentBlocks);
  });
});

describe('TODO: Verifier <-> storage', async () => {
  console.log('TODO: Verifier <-> storage tests');
});