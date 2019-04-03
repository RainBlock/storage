import {hashAsBigInt, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import * as grpc from 'grpc';
import {RlpDecode, RlpList} from 'rlp-stream/build/src/rlp-stream';

import * as StorageNodeService from '../build/proto/clientStorage_grpc_pb';
import {AccountRequest, BlockHashRequest, CodeRequest, StorageRequest} from '../build/proto/clientStorage_pb';

import {EthereumAccount, rlpToEthereumAccount} from './utils';

const wait = require('wait-for-stuff');
const codeInfoTimeArray = new Array<number>();
const accountTimeArray = new Array<number>();

let serialize = false;
const times = 1;

const readAccounts = () => {
  const accounts =
      fs.readFileSync(__dirname + '/test_data/genesis_accounts.txt')
          .toString()
          .split('\n');
  // const accounts = [];
  // accounts.push(accounts1[0])
  return accounts;
};

const benchGetCodeInfoNoCode =
    (client: StorageNodeService.StorageNodeClient, accounts: string[]) => {
      const codeRequestArray = new Array<CodeRequest>();
      for (let idx = 0; idx < accounts.length; idx++) {
        const request = new CodeRequest();
        request.setAddress(Buffer.from(accounts[idx], 'hex'));
        request.setCodeOnly(true);
        codeRequestArray.push(request);
      }
      const len = accounts.length;
      let finished = 0;
      const hrstart = process.hrtime();
      for (let idx = 0; idx < len * times; idx++) {
        client.getCodeInfo(codeRequestArray[idx % len], (err, response) => {
          if (err) {
            throw new Error('Error in getCodeInfo rpc');
          }
          finished++;
          if (finished === len * times) {
            const hrend = process.hrtime(hrstart);
            const ops = len * times;
            const time = hrend![0] * 1000 + hrend![1] / 1000000;
            console.log(
                '%d ops/ms  %dops %dms CodeInfoNoCode', (ops / time).toFixed(2),
                ops, time);
            serialize = true;
          }
        });
      }
    };

const benchGetCodeInfo =
    (client: StorageNodeService.StorageNodeClient, accounts: string[]) => {
      const codeRequestArray = new Array<CodeRequest>();
      for (let idx = 0; idx < accounts.length; idx++) {
        const request = new CodeRequest();
        request.setAddress(Buffer.from(accounts[idx], 'hex'));
        request.setCodeOnly(false);
        codeRequestArray.push(request);
      }

      let finished = 0;
      const len = accounts.length;
      const hrstart = process.hrtime();
      //      for (let i = 0; i < times; i++) {
      for (let idx = 0; idx < len * times; idx++) {
        client.getCodeInfo(codeRequestArray[idx % len], (err, response) => {
          if (err) {
            throw new Error('Error in getCodeInfo rpc');
          }
          finished++;
          if (finished === len * times) {
            const hrend = process.hrtime(hrstart);
            const ops = len * times;
            const time = hrend![0] * 1000 + hrend![1] / 1000000;
            console.log(
                '%d ops/ms  %dops %dms CodeInfo', (ops / time).toFixed(2), ops,
                time);
            serialize = true;
          }
        });
      }
      //      }
    };

const benchGetSingleCodeInfo =
    (client: StorageNodeService.StorageNodeClient, accounts: string[]) => {
      const codeRequestArray = new Array<CodeRequest>();
      for (let idx = 0; idx < accounts.length; idx++) {
        const request = new CodeRequest();
        request.setAddress(Buffer.from(accounts[idx], 'hex'));
        request.setCodeOnly(false);
        codeRequestArray.push(request);
      }

      const processItems = (count: number) => {
        if (count < accounts.length) {
          // console.log("sending req ", count);
          const hrstart = process.hrtime();
          client.getCodeInfo(codeRequestArray[count], (err, response) => {
            if (err) {
              throw new Error('Error in getCodeInfo rpc');
            }
            const hrend = process.hrtime(hrstart);
            // console.log("Received resp ", count);
            const time = hrend![0] * 1000 + hrend![1] / 1000000;
            codeInfoTimeArray.push(time);
            if (count === accounts.length - 1) {
              serialize = true;
            }
            processItems(count + 1);
          });
        }
      };
      processItems(0);
    };

const benchGetSingleAccount =
    (client: StorageNodeService.StorageNodeClient, accounts: string[]) => {
      const accountRequestArray = new Array<AccountRequest>();
      for (let idx = 0; idx < accounts.length; idx++) {
        const request = new AccountRequest();
        request.setAddress(Buffer.from(accounts[idx], 'hex'));
        accountRequestArray.push(request);
      }

      const processItems = (count: number) => {
        if (count < accounts.length) {
          // console.log("sending req ", count);
          const hrstart = process.hrtime();
          client.getAccount(accountRequestArray[count], (err, response) => {
            if (err) {
              throw new Error('Error in getAccount rpc');
            }
            const hrend = process.hrtime(hrstart);
            // console.log("Received resp ", count);
            const time = hrend![0] * 1000 + hrend![1] / 1000000;
            accountTimeArray.push(time);
            if (count === accounts.length - 1) {
              serialize = true;
            }
            processItems(count + 1);
          });
        }
      };
      processItems(0);
    };

const benchGetAccount =
    (client: StorageNodeService.StorageNodeClient, accounts: string[]) => {
      const accountRequestArray = new Array<AccountRequest>();
      for (let idx = 0; idx < accounts.length; idx++) {
        const request = new AccountRequest();
        request.setAddress(Buffer.from(accounts[idx], 'hex'));
        accountRequestArray.push(request);
      }
      const len = accounts.length;
      let finished = 0;
      const hrstart = process.hrtime();
      //      for (let i = 0; i < times; i++) {
      for (let idx = 0; idx < len * times; idx++) {
        client.getAccount(accountRequestArray[idx % len], (err, response) => {
          if (err) {
            throw new Error('Error in getAccount rpc');
          }
          finished++;
          if (finished === len * times) {
            const hrend = process.hrtime(hrstart);
            const ops = len * times;
            const time = hrend![0] * 1000 + hrend![1] / 1000000;
            console.log(
                '%d ops/ms  %dops %dms Account', (ops / time).toFixed(2), ops,
                time);
            serialize = true;
          }
        });
      }
      //      }
    };

const benchGetAccountInexistent =
    (client: StorageNodeService.StorageNodeClient, accounts: string[]) => {
      const accountRequestArray = new Array<AccountRequest>();
      for (let idx = 0; idx < accounts.length; idx++) {
        const request = new AccountRequest();
        request.setAddress(
            Buffer.from('0000000000000000000000000000000000000000', 'hex'));
        accountRequestArray.push(request);
      }
      const len = accounts.length;
      let finished = 0;
      const hrstart = process.hrtime();
      //      for (let i = 0; i < times; i++) {
      for (let idx = 0; idx < len * times; idx++) {
        client.getAccount(accountRequestArray[idx % len], (err, response) => {
          if (err) {
            throw new Error('Error in getAccount rpc');
          }
          finished++;
          if (finished === len * times) {
            const hrend = process.hrtime(hrstart);
            const ops = len * times;
            const time = hrend![0] * 1000 + hrend![1] / 1000000;
            console.log(
                '%d ops/ms  %dops %dms AccountInexistent',
                (ops / time).toFixed(2), ops, time);
            serialize = true;
          }
        });
      }
      //      }
    };

const benchGetStorageKeyInexistent =
    (client: StorageNodeService.StorageNodeClient, accounts: string[]) => {
      const storageRequestArray = new Array<StorageRequest>();
      for (let idx = 0; idx < accounts.length; idx++) {
        const request = new StorageRequest();
        request.setAddress(Buffer.from(accounts[idx], 'hex'));
        request.setKey(Buffer.from(accounts[idx], 'hex'));
        storageRequestArray.push(request);
      }
      const len = accounts.length;
      let finished = 0;
      const hrstart = process.hrtime();
      //      for (let i = 0; i < times; i++) {
      for (let idx = 0; idx < len * times; idx++) {
        client.getStorage(storageRequestArray[idx % len], (err, response) => {
          if (err) {
            console.log(err);
            throw new Error('Error in benchGetStorageKeyInexistent rpc');
          }
          finished++;
          // console.log(idx);
          if (finished === len * times) {
            const hrend = process.hrtime(hrstart);
            const ops = len * times;
            const time = hrend![0] * 1000 + hrend![1] / 1000000;
            console.log(
                '%d ops/ms  %dops %dms StorageKeyInexistent',
                (ops / time).toFixed(2), ops, time);
            serialize = true;
          }
        });
      }
      //      }
    };

const benchGetStorage =
    (client: StorageNodeService.StorageNodeClient, accounts: string[]) => {
      const storageRequestArray = new Array<StorageRequest>();
      for (let idx = 0; idx < accounts.length; idx++) {
        const request = new StorageRequest();
        request.setAddress(Buffer.from(accounts[idx], 'hex'));
        request.setKey(
            Buffer.from('0000000000000000000000000000000000000001', 'hex'));
        storageRequestArray.push(request);
      }
      const len = accounts.length;
      let finished = 0;
      const hrstart = process.hrtime();
      //      for (let i = 0; i < times; i++) {
      for (let idx = 0; idx < len * times; idx++) {
        client.getStorage(storageRequestArray[idx % len], (err, response) => {
          if (err) {
            console.log(err);
            throw new Error('Error in benchGetStorageKeyInexistent rpc');
          }
          finished++;
          if (finished === len * times) {
            const hrend = process.hrtime(hrstart);
            const ops = len * times;
            const time = hrend![0] * 1000 + hrend![1] / 1000000;
            console.log(
                '%d ops/ms  %dops %dms Storage', (ops / time).toFixed(2), ops,
                time);
            serialize = true;
          }
        });
      }
      //      }
    };

// const benchTest = (client: StorageNodeService.StorageNodeClient, accounts:
// Array<string>) => {
//   const storageRequestArray = new Array<StorageRequest>();
//   for (let idx = 0; idx < accounts.length; idx++) {
//     let request = new StorageRequest();
//     request.setAddress(Buffer.from(accounts[idx], 'hex'));
//     request.setKey(Buffer.from('0000000000000000000000000000000000000001',
//     'hex')); storageRequestArray.push(request);
//   }

//   let totalTime = 0n;
//   let finished = 0;
//   const hrstart = process.hrtime.bigint();
//   for (let idx = 0; idx < accounts.length; idx++) {
//     client.getStorage(storageRequestArray[idx], (err, response) => {
//       // if (err) {
//       //   console.log(err);
//       //   throw new Error('Error in benchGetStorageKeyInexistent rpc');
//       // }
//       finished += 1;
//       // console.log("Finished:", finished);
//       if (finished === accounts.length) {
//         totalTime += (process.hrtime.bigint() - hrstart);
//         console.log("ops/sec : ",
//         (finished/(totalTime/1000000000)).toFixed(2));
//       //   serialize = true;
//       }
//     });
//   }
// };


const benchGetBlockHash = (client: StorageNodeService.StorageNodeClient) => {
  const blockValid = 0;
  let idx;
  const len = 8893;
  const request = new BlockHashRequest();
  request.setNumber(blockValid);
  let finished = 0;
  const hrstart = process.hrtime();
  //  for (let i = 0; i < times; i++) {
  for (idx = 0; idx < len * times; idx++) {
    client.getBlockHash(request, (err, response) => {
      const block = response.getHashesList();
      if (block.length === 0) {
        throw new Error('getBlockHash: Has response for invalid blocknumber');
      }
      finished++;
      if (finished === len * times) {
        const hrend = process.hrtime(hrstart);
        const ops = len * times;
        const time = hrend![0] * 1000 + hrend![1] / 1000000;
        console.log(
            '%d ops/ms  %dops %dms BlockHash', (ops / time).toFixed(2), ops,
            time);
        serialize = true;
      }
    });
  }
  //  }
};

const runTestClient = (host: string, port: string) => {
  const storageSocket = host + ':' + port;
  const client = new StorageNodeService.StorageNodeClient(
      storageSocket, grpc.credentials.createInsecure());

  const accounts = readAccounts();


  // Test with RPC calls
  try {
    benchGetCodeInfoNoCode(client, accounts);
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('GetCodeInfoNoCode Error: ', e);
  }
  serialize = false;
  try {
    benchGetCodeInfo(client, accounts);
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('GetCodeInfo Error: ', e);
  }
  serialize = false;
  try {
    benchGetAccount(client, accounts);
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('GetAccount Error: ', e);
  }
  serialize = false;
  try {
    benchGetAccountInexistent(client, accounts);
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('GetAccountInexistent Error: ', e);
  }
  serialize = false;
  try {
    benchGetStorageKeyInexistent(client, accounts);
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('GetStorageKeyInexistent Error: ', e);
  }
  serialize = false;
  try {
    benchGetStorage(client, accounts);
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('GetStorage Error: ', e);
  }
  serialize = false;
  try {
    benchGetBlockHash(client);
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('GetBlockHash Error: ', e);
  }
  serialize = false;

  // try {
  //    benchGetSingleCodeInfo(client, accounts);
  //    wait.for.predicate(() => serialize);
  //  } catch(e) {
  //    console.log("GetCodeInfo Error: ", e);
  //  }
  //  serialize=false;
  //  try {
  //    benchGetSingleAccount(client, accounts);
  //    wait.for.predicate(() => serialize);
  //  } catch(e) {
  //    console.log("GetAccount Error: ", e);
  //  }
  //  serialize=false;
  //  console.log("getCodeInfo, getAccount");
  //  for (let i=0; i<codeInfoTimeArray!.length; i++){
  //    console.log(codeInfoTimeArray![i] + ', ' +  accountTimeArray![i]);
  //  }
  // console.log("getAccount");
  // for (let i=0; i<accountTimeArray!.length; i++){
  //   console.log("ac", );
  // }
};

const printUsage = () => {
  console.log('USAGE: node -r ts-node/register src/testClient.ts');
  process.exit(-1);
};

const callClient = () => {
  if (process.argv.length !== 2) {
    printUsage();
  }
  // For local testing
  process.env.SNODES = 'localhost:50051';
  const snodes = process.env.SNODES;
  const enodes = process.env.ENODES;
  let host: string;
  let port: string;
  if (snodes === undefined) {
    console.log('Undefined storage node');
    process.exit(-2);
  } else {
    const slist = snodes.split(',');
    host = slist[0].split(':')[0];
    port = slist[0].split(':')[1];
    console.log('\nStarting client to connect server at:' + host + ':' + port);
    console.log('Results in logs/testClient.log\n');
    runTestClient(host, port);
  }
};

callClient();
