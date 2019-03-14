import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import {List} from 'lodash';
import {RlpDecode, RlpEncode, RlpList} from 'rlp-stream/build/src/rlp-stream';
import {chain} from 'stream-chain';
import {parser} from 'stream-json';
import {pick} from 'stream-json/filters/Pick';
import {streamObject} from 'stream-json/streamers/StreamObject';
import * as zlib from 'zlib';

const asyncChunks = require('async-chunks');
const wait = require('wait-for-stuff');

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
  let hexBalance = account.balance.toString(16);
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

export function getStateFromGethJSON(
    filename: string, compressed = false): GethPutOps[] {
  const prom = _getStateFromGethJSON(filename, compressed);
  let putOps: GethPutOps[] = [];
  prom.then((ops) => {
    putOps = ops;
  });
  wait.for.predicate(() => (putOps.length !== 0));
  return putOps;
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

async function _getStateFromGethJSON(filename: string, compressed = false) {
  if (!compressed) {
    const ops: GethPutOps[] = [];
    const gethJSON =
        JSON.parse(await fs.readFile(filename, {encoding: 'utf8'})) as
        GethStateDump;
    for (const [id, account] of Object.entries(gethJSON.accounts)) {
      ops.push({key: Buffer.from(id, 'hex'), val: account});
    }
    return ops;
  } else {
    const ops: GethPutOps[] = [];
    const pipeline = chain([
      fs.createReadStream(filename),
      zlib.createGunzip(),
      parser(),
      pick({filter: 'accounts'}),
      streamObject(),
    ]);
    for await (const data of asyncChunks(pipeline)) {
      ops.push({key: Buffer.from(data.key, 'hex'), val: data.val});
    }
    return ops;
  }
}

export interface UpdateOps {
  ops: Array<ValueChangeOp|DeletionOp|CreationOp|ExecutionOp>;
}

export interface ValueChangeOp {
  type: 'ValueChangeOp';
  account: Buffer;
  value: bigint;
  changes: number;
}

export interface DeletionOp {
  type: 'DeletionOp';
  account: Buffer;
}

export interface CreationOp {
  type: 'CreationOp';
  account: Buffer;
  value: bigint;
  code?: Buffer;
  storage: Map<bigint, bigint>;
}

export interface ExecutionOp {
  type: 'ExecutionOp';
  account: Buffer;
  value: bigint;
  storageUpdates: Array<StorageDeletion|StorageInsertion>;
}

export interface StorageInsertion {
  type: 'StorageInsertion';
  key: bigint;
  val: bigint;
}

export interface StorageDeletion {
  type: 'StorageDeletion';
  key: bigint;
}