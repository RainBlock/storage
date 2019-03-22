import 'mocha';

import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, HashType} from 'bigint-hash';
import * as chai from 'chai';
import * as path from 'path';
import {RlpDecode, RlpDecoderTransform, RlpList} from 'rlp-stream';
import {Readable} from 'stream';

import {StorageNode} from './index';
import {computeBlockHash, CreationOp, DeletionOp, ethereumAccountToRlp, ExecutionOp, rlpToEthereumAccount, StorageInsertion, UpdateOps, ValueChangeOp} from './utils';

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
    const accountVal = snode.get(account).value;
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
    const accountVal = snode.get(account).value;
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
    const accountVal = snode.get(account).value;
    should.not.exist(accountVal);
  });

  it('GetCode: existing account', async () => {
    const account =
        Buffer.from('000d836201318ec6899a67540690382780743280', 'hex');
    const codeHash = BigInt(
        '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');

    let codeAndAccount = snode.getCode(account, true);
    const code = codeAndAccount.code;
    const calCodeHash = hashAsBigInt(HashType.KECCAK256, code!);
    assertEquals(calCodeHash, codeHash);
    should.not.exist(codeAndAccount.account);

    codeAndAccount = snode.getCode(account, false);
    should.exist(codeAndAccount.account);
    should.exist(codeAndAccount.code);
  });

  it('GetCode: non existing account', async () => {
    const account =
        Buffer.from('000abcdefabcdefabcdef0001234567890abcdef', 'hex');
    let codeAndAccount = snode.getCode(account, false);
    should.not.exist(codeAndAccount.account!.value);
    should.not.exist(codeAndAccount.code);

    codeAndAccount = snode.getCode(account, true);
    should.not.exist(codeAndAccount.account);
    should.not.exist(codeAndAccount.code);
  });

  it('GetStorage: non existing account', async () => {
    const account =
        Buffer.from('000abcdefabcdefabcdef0001234567890abcdef', 'hex');
    const storage = snode.getStorage(account, toBigIntBE(account));
    should.not.exist(storage);
  });

  it('GetStorage: existing account but non existing storage', async () => {
    const account =
        Buffer.from('000d836201318ec6899a67540690382780743280', 'hex');
    const storage = snode.getStorage(account, toBigIntBE(account));
    should.not.exist(storage!.value);
  });

  it('GetBlockHash: non existing block', async () => {
    const blockInValid = snode.getBlockHash(BigInt(1));
    should.exist(blockInValid);
    blockInValid.length.should.equal(0);
  });

  it('GetRecentBlocks and GetBlockHash', async () => {
    const recentBlocks = snode.getRecentBlocks();
    assertEquals(BigInt(recentBlocks.length), BigInt(1));
    const blocks = snode.getBlockHash(BigInt(0));
    blocks.should.deep.equal(recentBlocks);
  });
});

describe('Verifier <-> storage update with CreationOP', async () => {
  const address =
      Buffer.from('000abcdefabcdefabcdef0001234567890abcdef', 'hex');
  const balance = BigInt(10);
  const code = address;
  const codeHash = hashAsBigInt(HashType.KECCAK256, code);
  const storage = new Map<bigint, bigint>();
  storage.set(toBigIntBE(address), toBigIntBE(address));
  const newAccount: CreationOp =
      {type: 'CreationOp', account: address, value: balance, code, storage};

  const rlpBlocks: RlpList[] = [];
  before(async () => {
    for await (const chunk of asyncChunks(await loadStream(BLOCK_FIRST10))) {
      rlpBlocks.push(chunk);
    }
  });

  it('Should be able to read account', async () => {
    snode.update(rlpBlocks[1], {ops: [newAccount]} as UpdateOps);
    const accountVal = snode.get(address).value;
    const rlpAccount = RlpDecode(accountVal!) as RlpList;
    const ethAccount = rlpToEthereumAccount(rlpAccount);
    assertEquals(ethAccount.nonce, BigInt(0));
    assertEquals(ethAccount.balance, balance);
    assertEquals(ethAccount.codeHash, codeHash);
  });

  it('Should be able to read code', async () => {
    const readCode = snode.getCode(address, true).code;
    should.exist(readCode);
    readCode!.should.deep.equal(code);
  });

  it('Should be able to read storage', async () => {
    const readStorage = snode.getStorage(address, toBigIntBE(address));
    const val = readStorage!.value!;
    val.should.deep.equal(address);
  });
});

describe('Verifier <-> storage update with ValueChangeOp', async () => {
  const address =
      Buffer.from('000abcdefabcdefabcdef0001234567890abcdef', 'hex');
  const balance = BigInt(100);
  const changes = 20;
  const codeHash = hashAsBigInt(HashType.KECCAK256, address);
  const updateAccount: ValueChangeOp =
      {type: 'ValueChangeOp', account: address, value: balance, changes};

  const rlpBlocks: RlpList[] = [];
  before(async () => {
    for await (const chunk of asyncChunks(await loadStream(BLOCK_FIRST10))) {
      rlpBlocks.push(chunk);
    }
  });

  it('Should be able to read the modified account', async () => {
    snode.update(rlpBlocks[2], {ops: [updateAccount]} as UpdateOps);
    const accountVal = snode.get(address).value;
    const rlpAccount = RlpDecode(accountVal!) as RlpList;
    const ethAccount = rlpToEthereumAccount(rlpAccount);
    assertEquals(ethAccount.codeHash, codeHash);
  });

  it('Account should reflect new balance and nonce', async () => {
    const accountVal = snode.get(address).value;
    const rlpAccount = RlpDecode(accountVal!) as RlpList;
    const ethAccount = rlpToEthereumAccount(rlpAccount);
    assertEquals(ethAccount.nonce, BigInt(20));
    assertEquals(ethAccount.balance, balance);
  });

  it('Should be able to read unmodified code', async () => {
    const readCode = snode.getCode(address, true).code;
    should.exist(readCode);
    readCode!.should.deep.equal(address);
  });

  it('Should be able to read unmodified storage', async () => {
    const readStorage = snode.getStorage(address, toBigIntBE(address));
    const val = readStorage!.value!;
    val.should.deep.equal(address);
  });
});

describe('Verifier <-> storage update with ExecutionOP', async () => {
  const address =
      Buffer.from('000abcdefabcdefabcdef0001234567890abcdef', 'hex');
  const balance = BigInt(200);
  const codeHash = hashAsBigInt(HashType.KECCAK256, address);
  const updatedStorageValue =
      Buffer.from('0000000000000000000000001234567890000000', 'hex');

  const storageUpdates = [{
    type: 'StorageInsertion',
    key: toBigIntBE(address),
    val: toBigIntBE(updatedStorageValue),
  } as StorageInsertion];

  const updateAccount: ExecutionOp =
      {type: 'ExecutionOp', account: address, value: balance, storageUpdates};

  const rlpBlocks: RlpList[] = [];
  before(async () => {
    for await (const chunk of asyncChunks(await loadStream(BLOCK_FIRST10))) {
      rlpBlocks.push(chunk);
    }
  });

  it('Should be able to read the modified account', async () => {
    snode.update(rlpBlocks[3], {ops: [updateAccount]} as UpdateOps);
    const accountVal = snode.get(address).value;
    const rlpAccount = RlpDecode(accountVal!) as RlpList;
    const ethAccount = rlpToEthereumAccount(rlpAccount);
    assertEquals(ethAccount.balance, balance);
    assertEquals(ethAccount.codeHash, codeHash);
  });

  it('Account should have the updated balance', async () => {
    const accountVal = snode.get(address).value;
    const rlpAccount = RlpDecode(accountVal!) as RlpList;
    const ethAccount = rlpToEthereumAccount(rlpAccount);
    assertEquals(ethAccount.balance, balance);
  });

  it('Account should have the modified storage', async () => {
    const readStorage = snode.getStorage(address, toBigIntBE(address));
    const val = readStorage!.value!;
    val.should.deep.equal(updatedStorageValue);
  });

  it('Should be able to read unmodified code', async () => {
    const readCode = snode.getCode(address, true).code;
    should.exist(readCode);
    readCode!.should.deep.equal(address);
  });
});

describe('Verifier <-> storage update with DeletionOp', async () => {
  const address =
      Buffer.from('000abcdefabcdefabcdef0001234567890abcdef', 'hex');

  const updateAccount: DeletionOp = {type: 'DeletionOp', account: address};

  const rlpBlocks: RlpList[] = [];
  before(async () => {
    for await (const chunk of asyncChunks(await loadStream(BLOCK_FIRST10))) {
      rlpBlocks.push(chunk);
    }
  });

  it('Should delete the account', async () => {
    snode.update(rlpBlocks[4], {ops: [updateAccount]} as UpdateOps);
    const accountVal = snode.get(address).value;
    should.not.exist(accountVal);
  });

  it('Should delete the deleted account\'s storage', async () => {
    const readStorage = snode.getStorage(address, toBigIntBE(address));
    should.not.exist(readStorage);
  });

  it('Should delete the deleted accounts code', async () => {
    const readCode = snode.getCode(address, true).code;
    should.not.exist(readCode);
  });

  it('Global state root hash should match genesis state hash', async () => {
    const last = snode._highestBlockNumber;
    const root = snode._activeSnapshots.get(last)[0].root;
    const genRoot = Buffer.from(
        'd7f8974fb5ac78d9ac099b9ad5018bedc2ce0a72dad1827a1709da30580f0544',
        'hex');
    root.should.deep.equal(genRoot);
  });
});