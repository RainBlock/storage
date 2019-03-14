import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import {RlpEncode, RlpList} from 'rlp-stream/build/src/rlp-stream';
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