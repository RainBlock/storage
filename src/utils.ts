import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import {RlpEncode, RlpList} from 'rlp-stream/build/src/rlp-stream';
const wait = require('wait-for-stuff');

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

export function getStateFromGethJSON(filename: string): GethPutOps[] {
  const putOpsPromise = _getStateFromGethJSON(filename);
  let putOps: GethPutOps[] = [];
  putOpsPromise.then((ops) => {
    putOps = ops;
  });
  wait.for.predicate(() => putOps.length);
  return putOps;
}

async function _getStateFromGethJSON(filename: string) {
  const ops: GethPutOps[] = [];
  const gethJSON =
      JSON.parse(await fs.readFile(filename, {encoding: 'utf8'})) as
      GethStateDump;
  for (const [id, account] of Object.entries(gethJSON.accounts)) {
    const throwAwayKey = toBufferBE(BigInt(`0x${id}`), 20);
    ops.push({key: toBufferBE(BigInt(`0x${id}`), 20), val: account});
  }
  return ops;
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
