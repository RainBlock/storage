import {toBigIntBE} from 'bigint-buffer';
import {hashAsBigInt, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import {RlpDecode, RlpList} from 'rlp-stream/build/src/rlp-stream';

import {StorageNode} from './index';
import {EthereumAccount, rlpToEthereumAccount} from './utils';

// const wait = require('wait-for-stuff');

// let serialize = false;
const storage = new StorageNode(-1);

const readAccounts = () => {
  const accounts =
      fs.readFileSync(__dirname + '/test_data/genesis_accounts.txt')
          .toString()
          .split('\n');
  // const accounts = [];
  // accounts.push(accounts1[0])
  return accounts;
};

const benchGetCodeInfoNoCode = (accounts: string[]) => {
  const addresses = new Array<Buffer>();
  for (let idx = 0; idx < accounts.length; idx++) {
    const address = Buffer.from(accounts[idx], 'hex');
    addresses.push(address);
  }

  const hrstart = process.hrtime();
  for (let idx = 0; idx < accounts.length; idx++) {
    const ret = storage.getCode(addresses[idx], true);
  }
  const hrend = process.hrtime(hrstart);
  const ops = accounts.length;
  const time = hrend![0] * 1000 + hrend![1] / 1000000;
  console.log(
      '%d ops/ms  %dops %dms CodeInfoNoCode', (ops / time).toFixed(2), ops,
      time.toFixed(0));
};

const benchGetCodeInfo = (accounts: string[]) => {
  const addresses = new Array<Buffer>();
  for (let idx = 0; idx < accounts.length; idx++) {
    const address = Buffer.from(accounts[idx], 'hex');
    addresses.push(address);
  }

  const hrstart = process.hrtime();
  for (let idx = 0; idx < accounts.length; idx++) {
    const ret = storage.getCode(addresses[idx], false);
  }
  const hrend = process.hrtime(hrstart);
  const ops = accounts.length;
  const time = hrend![0] * 1000 + hrend![1] / 1000000;
  console.log(
      '%d ops/ms  %dops %dms CodeInfo', (ops / time).toFixed(2), ops,
      time.toFixed(0));
};

const benchGetAccount = (accounts: string[]) => {
  const addresses = new Array<Buffer>();
  for (let idx = 0; idx < accounts.length; idx++) {
    const address = Buffer.from(accounts[idx], 'hex');
    addresses.push(address);
  }

  const hrstart = process.hrtime();
  for (let idx = 0; idx < accounts.length; idx++) {
    const ret = storage.get(addresses[idx]);
  }
  const hrend = process.hrtime(hrstart);
  const ops = accounts.length;
  const time = hrend![0] * 1000 + hrend![1] / 1000000;
  console.log(
      '%d ops/ms  %dops %dms Account', (ops / time).toFixed(2), ops,
      time.toFixed(0));
};

const benchGetAccountInexistent = (accounts: string[]) => {
  const addresses = new Array<Buffer>();
  for (let idx = 0; idx < accounts.length; idx++) {
    const address =
        Buffer.from('0000000000000000000000000000000000000000', 'hex');
    addresses.push(address);
  }

  const hrstart = process.hrtime();
  for (let idx = 0; idx < accounts.length; idx++) {
    const ret = storage.get(addresses[idx]);
  }
  const hrend = process.hrtime(hrstart);
  const ops = accounts.length;
  const time = hrend![0] * 1000 + hrend![1] / 1000000;
  console.log(
      '%d ops/ms  %dops %dms AccountInexistent', (ops / time).toFixed(2), ops,
      time.toFixed(0));
};

const benchGetStorage = (accounts: string[]) => {
  const addresses = new Array<Buffer>();
  const key = Buffer.from('0000000000000000000000000000000000000001', 'hex');
  for (let idx = 0; idx < accounts.length; idx++) {
    const address = Buffer.from(accounts[idx], 'hex');
    addresses.push(address);
  }

  const hrstart = process.hrtime();
  for (let idx = 0; idx < accounts.length; idx++) {
    const ret = storage.getStorage(addresses[idx], toBigIntBE(key));
  }
  const hrend = process.hrtime(hrstart);
  const ops = accounts.length;
  const time = hrend![0] * 1000 + hrend![1] / 1000000;
  console.log(
      '%d ops/ms  %dops %dms Storage', (ops / time).toFixed(2), ops,
      time.toFixed(0));
};

const benchGetStorageKeyInexistent = (accounts: string[]) => {
  const addresses = new Array<Buffer>();
  const key = Buffer.from('0000000000000000000000000000000000000001', 'hex');
  for (let idx = 0; idx < accounts.length; idx++) {
    const address = Buffer.from(accounts[idx], 'hex');
    addresses.push(address);
  }

  const hrstart = process.hrtime();
  for (let idx = 0; idx < accounts.length; idx++) {
    const ret = storage.getStorage(addresses[idx], toBigIntBE(addresses[idx]));
  }
  const hrend = process.hrtime(hrstart);
  const ops = accounts.length;
  const time = hrend![0] * 1000 + hrend![1] / 1000000;
  console.log(
      '%d ops/ms  %dops %dms StorageKeyInexistent', (ops / time).toFixed(2),
      ops, time.toFixed(0));
};

const benchGetBlockHash = () => {
  const blockValid = 0n;
  const len = 8893;
  const hrstart = process.hrtime();
  for (let idx = 0; idx < len; idx++) {
    storage.getBlockHash(blockValid);
  }
  const hrend = process.hrtime(hrstart);
  const ops = len;
  const time = hrend![0] * 1000 + hrend![1] / 1000000;
  console.log(
      '%d ops/ms  %dops %dms BlockHash', (ops / time).toFixed(2), ops,
      time.toFixed(0));
};

const runTestStorage = () => {
  const accounts = readAccounts();
  // storage = new StorageNode(-1);

  // Test
  try {
    benchGetCodeInfoNoCode(accounts);
    // wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('GetCodeInfoNoCode Error: ', e);
  }
  // serialize = false;
  try {
    benchGetCodeInfo(accounts);
    // wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('GetCodeInfo Error: ', e);
  }
  try {
    benchGetAccount(accounts);
    // wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('GetAccount Error: ', e);
  }
  try {
    benchGetAccountInexistent(accounts);
    // wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('GetAccountInexistent Error: ', e);
  }
  try {
    benchGetStorage(accounts);
    // wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('GetStorage Error: ', e);
  }
  try {
    benchGetStorageKeyInexistent(accounts);
  } catch (e) {
    console.log('GetStorageKeyInexistent Error: ', e);
  }
  try {
    benchGetBlockHash();
  } catch (e) {
    console.log('GetBlockHash Error: ', e);
  }
};

// const printUsage = () => {
//   console.log('USAGE: node -r ts-node/register src/testClient.ts');
//   process.exit(-1);
// };

// const callClient = () => {
//   if (process.argv.length !== 2) {
//     printUsage();
//   }
//   // For local testing
//   process.env.SNODES = 'localhost:50051';
//   const snodes = process.env.SNODES;
//   const enodes = process.env.ENODES;
//   let host: string;
//   let port: string;
//   if (snodes === undefined) {
//     console.log('Undefined storage node');
//     process.exit(-2);
//   } else {
//     const slist = snodes.split(',');
//     host = slist[0].split(':')[0];
//     port = slist[0].split(':')[1];
//     console.log('\nStarting client to connect server at:' + host + ':' +
//     port); console.log('Results in logs/testClient.log\n');
//     runTestClient(host, port);
//   }
// };

// callClient();
runTestStorage();