import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import {RlpEncode, RlpList} from 'rlp-stream/build/src/rlp-stream';
const wait = require('wait-for-stuff');

import {chain} from 'stream-chain';
import {parser} from 'stream-json';
import {pick} from 'stream-json/filters/Pick';
import {streamObject} from 'stream-json/streamers/StreamObject';
import * as zlib from 'zlib';
import { MerklePatriciaTree } from '@rainblock/merkle-patricia-tree/build/src';

const asyncChunks = require('async-chunks');


export function computeBlockHash(block: RlpList): bigint {
  const blockBuffer = RlpEncode(block[0]);
  const hash = hashAsBigInt(HashType.KECCAK256, blockBuffer);
  return hash;
}

export interface GethStateDumpAccount {
  balance: string;
  nonce: number;
  root: string;
  codeHash: string;
  code: string;
  storage: {[key: string]: string};
}

export interface EthereumAccount {
  balance: bigint;
  nonce: bigint;
  storageRoot: bigint;
  codeHash: bigint;
}

export interface GethStateDump {
  root: string;
  accounts: {[id: string]: GethStateDumpAccount};
}

export interface GethPutOps {
  key: Buffer;
  val: GethStateDumpAccount;
}

export function ethereumAccountToRlp(account: EthereumAccount): Buffer {
  let hexBalance = account.balance!.toString(16);
  if (hexBalance === '0') {
    hexBalance = '';
  } else if (hexBalance.length % 2 === 1) {
    hexBalance = `0${hexBalance}`;
  }

  return RlpEncode([
    Number(account.nonce), Buffer.from(hexBalance, 'hex'),
    toBufferBE(account.storageRoot, 32), toBufferBE(account.codeHash, 32)
  ] as RlpList);
}

export function rlpToEthereumAccount(rlpAccount: RlpList): EthereumAccount {
  if (!Array.isArray(rlpAccount)) {
    throw new Error(`Expected RLP-encoded list!`);
  }
  const nonce = toBigIntBE(rlpAccount[0] as Buffer);
  const balance = toBigIntBE(rlpAccount[1] as Buffer);
  const storageRoot = toBigIntBE(rlpAccount[2] as Buffer);
  const codeHash = toBigIntBE(rlpAccount[3] as Buffer);
  const account = {nonce, balance, storageRoot, codeHash};
  return account;
}

export function gethAccountToEthAccount(account: GethStateDumpAccount):
    EthereumAccount {
  const code = Buffer.from(account.code, 'hex');
  const ethAccount: EthereumAccount = {
    balance: BigInt(account.balance),
    nonce: BigInt(account.nonce),
    codeHash: hashAsBigInt(HashType.KECCAK256, code),
    storageRoot: toBigIntBE(Buffer.from(account.root, 'hex'))
  };
  return ethAccount;
}

export function getStateFromGethJSON(
    trie: MerklePatriciaTree, storageTrie: MerklePatriciaTree<bigint, Buffer>,
    filename: string, compressed = false): Set<bigint> {
  const putOpsPromise = _getStateFromGethJSON(trie, storageTrie, filename, compressed);
  let codesArray: Set<bigint> = new Set<bigint>();
  let isDone = false;
  putOpsPromise.then((reply: {codes: Set<bigint>, done: boolean}) => {
    codesArray = reply.codes;
    isDone = reply.done;
  });
  wait.for.predicate(() => isDone);
  return codesArray;
}

async function _getStateFromGethJSON(
    trie: MerklePatriciaTree, storageTrie: MerklePatriciaTree<bigint, Buffer>,
    filename: string, compressed: boolean) {
  const codes = new Set<bigint>();
  if (!compressed) {
    const gethJSON =
        JSON.parse(await fs.readFile(filename, {encoding: 'utf8'})) as
        GethStateDump;
    for (const [id, account] of Object.entries(gethJSON.accounts)) {
      const val = gethAccountToEthAccount(account);
      trie.put(toBufferBE(BigInt(`0x${id}`), 20), ethereumAccountToRlp(val));
      const storageEntries = Object.entries(account.storage);
      for (const [key, value] of storageEntries) {
        const k = BigInt(`0x${key}`);
        const v = Buffer.from(value, 'hex');
        storageTrie.put(k, v);
      }
      if (account.code.length) {
        codes.add(BigInt(`0x${account.code}`));
      }
    }
  } else {
    const pipeline = chain([
      fs.createReadStream(filename),
      zlib.createGunzip(),
      parser(),
      pick({filter: 'accounts'}),
      streamObject(),
    ]);
    for await (const data of asyncChunks(pipeline)) {
      trie.put(toBufferBE(BigInt(`0x${data.key}`), 20), ethereumAccountToRlp(data.value));
      const storageEntries = data.value.storage.entries;
      for (const [key, value] of storageEntries) {
        const k = BigInt(`0x${key}`);
        const v = Buffer.from(value, 'hex');
        storageTrie.put(k, v);
      }
      codes.add(BigInt(`0x${data.value.code}`));
    }
  }
  return {codes, done: true};
}

export interface UpdateOps {
  account: Buffer;
  balance?: bigint;
  nonce?: bigint;
  storage?: StorageUpdates[];
  code?: Buffer;
  deleted?: boolean;
}

export interface StorageUpdates {
  key: bigint;
  value: bigint;
}
