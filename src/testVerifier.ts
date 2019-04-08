import {AccountRequest, StorageNodeClient, StorageRequest, StorageUpdate, UpdateMsg, UpdateOp, VerifierStorageClient} from '@rainblock/protocol';
import {toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, HashType} from 'bigint-hash';
import * as grpc from 'grpc';
import * as path from 'path';
import {RlpDecode, RlpDecoderTransform, RlpEncode, RlpList} from 'rlp-stream';

import {rlpToEthereumAccount} from './utils';

const wait = require('wait-for-stuff');
const fs = require('fs-extra');
const asyncChunks = require('async-chunks');

const debugLog = fs.createWriteStream('./logs/testVerifier.log', {flags: 'a'});
const assertEquals = (n0: bigint, n1: bigint) => {
  if (n0 !== n1) {
    let errorString = 'AssertionError!\n';
    errorString += 'Received: ' + n0.toString() + '\n';
    errorString += 'Expected: ' + n1.toString() + '\n';
    throw new Error(errorString);
  }
};

const BLOCK_FIRST10 = 'test_data/first10.bin';
let serialize = false;

const loadStream = async (filename: string) => {
  const decoder = new RlpDecoderTransform();
  fs.createReadStream(path.join(__dirname, filename)).pipe(decoder);
  return decoder;
};

const getData = () => {
  const promdata = getEthereumBlocks();
  let data: RlpList[] = [];
  promdata.then((retdata) => {
    data = retdata;
  });
  wait.for.predicate(() => data.length === 10);
  return data;
};

const getEthereumBlocks = async () => {
  const rlpBlocks: RlpList[] = [];

  for await (const chunk of asyncChunks(await loadStream(BLOCK_FIRST10))) {
    rlpBlocks.push(chunk);
  }
  return rlpBlocks;
};

const testUpdateNewAccount = async (
    verifier: VerifierStorageClient, block: RlpList,
    client: StorageNodeClient) => {
  // create request

  const createOp = new UpdateOp();
  const address =
      Buffer.from('000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
  const bigIntBalance = BigInt(100);
  const balance = toBufferBE(bigIntBalance, 1);
  const code = address;
  const storageList = new Array<StorageUpdate>();
  const storage = new StorageUpdate();
  storage.setKey(address);
  storage.setValue(address);
  storageList.push(storage);
  createOp.setAccount(address);
  createOp.setBalance(balance);
  createOp.setCode(code);
  createOp.setStorageUpdateList(storageList);

  // pack request
  const updateMsg = new UpdateMsg();
  const opList = new Array<UpdateOp>();
  opList.push(createOp);
  updateMsg.setRlpBlock(RlpEncode(block) as Buffer);
  updateMsg.setOperationsList(opList);

  // storage update
  verifier.update(updateMsg, (err, resp) => {
    if (err) {
      throw new Error('Update new account creation failed');
    }
    const request = new AccountRequest();
    request.setAddress(address);
    client.getAccount(request, (err, response) => {
      if (err) {
        throw new Error('Error in getAccount rpc');
      }
      const nonce = BigInt(0);

      // unpack response
      const accountVal = Buffer.from(response.getWitness()!.getValue_asU8());
      const rlpAccount = RlpDecode(accountVal) as RlpList;
      const account = rlpToEthereumAccount(rlpAccount);

      // check correctness
      assertEquals(account.nonce, nonce);
      assertEquals(account.balance, bigIntBalance);

      // Logging Information
      console.log('Test Success: New Account Creation');
      debugLog.write('Test Success: New Account Creation\n');
      debugLog.write('Account:\n');
      debugLog.write(account.balance.toString() + '\n');
      debugLog.write(account.nonce.toString() + '\n');
      debugLog.write(account.codeHash.toString() + '\n');
      debugLog.write(account.storageRoot.toString() + '\n');
      debugLog.write('-------------------------------------------------\n');

      // Allow next call
      serialize = true;
    });
  });
};

const testModifyBalance = async (
    verifier: VerifierStorageClient, block: RlpList,
    client: StorageNodeClient) => {
  // create request

  const createOp = new UpdateOp();
  const address =
      Buffer.from('000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
  const bigIntBalance = BigInt(100000);
  createOp.setAccount(address);
  createOp.setBalance(toBufferBE(bigIntBalance, 6));

  // pack request
  const updateMsg = new UpdateMsg();
  const opList = new Array<UpdateOp>();
  opList.push(createOp);
  updateMsg.setRlpBlock(RlpEncode(block) as Buffer);
  updateMsg.setOperationsList(opList);

  // storage update
  verifier.update(updateMsg, (err, resp) => {
    if (err) {
      console.log(err);
      throw new Error('Update modifying balance failed');
    }
    const request = new AccountRequest();
    request.setAddress(address);
    client.getAccount(request, (err, response) => {
      if (err) {
        throw new Error('Error in getAccount rpc');
      }
      const nonce = BigInt(0);

      // unpack response
      const accountVal = Buffer.from(response.getWitness()!.getValue_asU8());
      const rlpAccount = RlpDecode(accountVal) as RlpList;
      const account = rlpToEthereumAccount(rlpAccount);

      // check correctness
      assertEquals(account.nonce, nonce);
      assertEquals(account.balance, bigIntBalance);

      // Logging Information
      console.log('Test Success: Modifying balance');
      debugLog.write('Test Success: Modifying balance\n');
      debugLog.write('Account:\n');
      debugLog.write(account.balance.toString() + '\n');
      debugLog.write(account.nonce.toString() + '\n');
      debugLog.write(account.codeHash.toString() + '\n');
      debugLog.write(account.storageRoot.toString() + '\n');
      debugLog.write('-------------------------------------------------\n');

      // Allow next call
      serialize = true;
    });
  });
};

const testModifyNonce = async (
    verifier: VerifierStorageClient, block: RlpList,
    client: StorageNodeClient) => {
  // create request

  const createOp = new UpdateOp();
  const address =
      Buffer.from('000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
  const nonce = BigInt(100000);
  createOp.setAccount(address);
  createOp.setNonce(100000);

  // pack request
  const updateMsg = new UpdateMsg();
  const opList = new Array<UpdateOp>();
  opList.push(createOp);
  updateMsg.setRlpBlock(RlpEncode(block) as Buffer);
  updateMsg.setOperationsList(opList);

  // storage update
  verifier.update(updateMsg, (err, resp) => {
    if (err) {
      console.log(err);
      throw new Error('Update modifying nonce failed');
    }
    const request = new AccountRequest();
    request.setAddress(address);
    client.getAccount(request, (err, response) => {
      if (err) {
        throw new Error('Error in getAccount rpc');
      }

      // unpack response
      const accountVal = Buffer.from(response.getWitness()!.getValue_asU8());
      const rlpAccount = RlpDecode(accountVal) as RlpList;
      const account = rlpToEthereumAccount(rlpAccount);

      // check correctness
      assertEquals(account.nonce, nonce);

      // Logging Information
      console.log('Test Success: Modifying nonce');
      debugLog.write('Test Success: Modifying nonce\n');
      debugLog.write('Account:\n');
      debugLog.write(account.balance.toString() + '\n');
      debugLog.write(account.nonce.toString() + '\n');
      debugLog.write(account.codeHash.toString() + '\n');
      debugLog.write(account.storageRoot.toString() + '\n');
      debugLog.write('-------------------------------------------------\n');

      // Allow next call
      serialize = true;
    });
  });
};

const testModifyStorage = async (
    verifier: VerifierStorageClient, block: RlpList,
    client: StorageNodeClient) => {
  // create request

  const createOp = new UpdateOp();
  const storageOp = new StorageUpdate();
  const address =
      Buffer.from('000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
  createOp.setAccount(address);
  storageOp.setKey(address);
  storageOp.setValue(address);
  createOp.setStorageUpdateList([storageOp]);

  // pack request
  const updateMsg = new UpdateMsg();
  const opList = new Array<UpdateOp>();
  opList.push(createOp);
  updateMsg.setRlpBlock(RlpEncode(block) as Buffer);
  updateMsg.setOperationsList(opList);

  // storage update
  verifier.update(updateMsg, (err, resp) => {
    if (err) {
      console.log(err);
      throw new Error('Update modifying storage failed');
    }
    const request = new StorageRequest();
    request.setAddress(address);
    request.setKey(address);
    client.getStorage(request, (err, response) => {
      if (err) {
        throw new Error('Error in getAccount rpc');
      }

      // unpack response
      const value = Buffer.from(response.getWitness()!.getValue_asU8());

      // check correctness
      if (Buffer.compare(value, address) !== 0) {
        throw new Error('ERROR: Unable to update account storage');
      }

      // Logging Information
      console.log('Test Success: Modifying storage');
      debugLog.write('Test Success: Modifying storage\n');
      debugLog.write('Storage at address:\n', address, ' is value: ', value);
      debugLog.write('-------------------------------------------------\n');

      // Allow next call
      serialize = true;
    });
  });
};

const testModifyCode = async (
    verifier: VerifierStorageClient, block: RlpList,
    client: StorageNodeClient) => {
  // create request

  const createOp = new UpdateOp();
  const address =
      Buffer.from('000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
  const code = Buffer.from('12345678910');
  const codeHash = hashAsBigInt(HashType.KECCAK256, code);
  createOp.setAccount(address);
  createOp.setCode(code);

  // pack request
  const updateMsg = new UpdateMsg();
  const opList = new Array<UpdateOp>();
  opList.push(createOp);
  updateMsg.setRlpBlock(RlpEncode(block) as Buffer);
  updateMsg.setOperationsList(opList);

  // storage update
  verifier.update(updateMsg, (err, resp) => {
    if (err) {
      console.log(err);
      throw new Error('Update modifying nonce failed');
    }
    const request = new AccountRequest();
    request.setAddress(address);
    client.getAccount(request, (err, response) => {
      if (err) {
        throw new Error('Error in getAccount rpc');
      }

      // unpack response
      const accountVal = Buffer.from(response.getWitness()!.getValue_asU8());
      const rlpAccount = RlpDecode(accountVal) as RlpList;
      const account = rlpToEthereumAccount(rlpAccount);

      // check correctness
      assertEquals(account.codeHash, codeHash);

      // Logging Information
      console.log('Test Success: Modifying code');
      debugLog.write('Test Success: Modifying code\n');
      debugLog.write('Account:\n');
      debugLog.write(account.balance.toString() + '\n');
      debugLog.write(account.nonce.toString() + '\n');
      debugLog.write(account.codeHash.toString() + '\n');
      debugLog.write(account.storageRoot.toString() + '\n');
      debugLog.write('-------------------------------------------------\n');

      // Allow next call
      serialize = true;
    });
  });
};

const testDelete = async (
    verifier: VerifierStorageClient, block: RlpList,
    client: StorageNodeClient) => {
  // create request

  const createOp = new UpdateOp();
  const storageOp = new StorageUpdate();
  const address =
      Buffer.from('000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
  const bigIntBalance = BigInt(100000);
  const nonce = BigInt(100);
  createOp.setAccount(address);
  createOp.setDeleted(true);
  createOp.setBalance(toBufferBE(bigIntBalance, 6));
  createOp.setNonce(Number(nonce));
  storageOp.setKey(address);
  storageOp.setValue(address);
  createOp.setStorageUpdateList([storageOp]);

  // pack request
  const updateMsg = new UpdateMsg();
  const opList = new Array<UpdateOp>();
  opList.push(createOp);
  updateMsg.setRlpBlock(RlpEncode(block) as Buffer);
  updateMsg.setOperationsList(opList);

  // storage update
  verifier.update(updateMsg, (err, resp) => {
    if (err) {
      console.log(err);
      throw new Error('Update modifying storage failed');
    }
    const request = new AccountRequest();
    request.setAddress(address);
    client.getAccount(request, (err, response) => {
      if (err) {
        throw new Error('Error in getAccount rpc');
      }

      // unpack response
      const value = Buffer.from(response.getWitness()!.getValue_asU8());

      // check correctness
      if (value.length) {
        throw new Error('ERROR: Unable to delete account');
      }

      // Logging Information
      console.log('Test Success: Deleting account');
      debugLog.write('Test Success: Deleting account\n');
      debugLog.write('-------------------------------------------------\n');

      // Allow next call
      serialize = true;
    });
  });
};

const runVerifier = (host: string, port: string) => {
  const storageSocket = host + ':' + port;
  const verifier = new VerifierStorageClient(
      storageSocket, grpc.credentials.createInsecure());
  const checkerClient =
      new StorageNodeClient(storageSocket, grpc.credentials.createInsecure());

  // Get the data required
  const data: RlpList[] = getData();

  // Test server update RPC
  try {
    testUpdateNewAccount(verifier, data[1], checkerClient);
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('Failed: New Account creation', e);
  }
  serialize = false;
  try {
    testModifyBalance(verifier, data[2], checkerClient);
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('Failed: Update account balance', e);
  }
  serialize = false;
  try {
    testModifyNonce(verifier, data[3], checkerClient);
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('Failed: Update account nonce', e);
  }
  serialize = false;
  try {
    testModifyStorage(verifier, data[4], checkerClient);
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('Failed: Update account storage', e);
  }
  serialize = false;
  try {
    testModifyCode(verifier, data[5], checkerClient);
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('Failed: Update account storage', e);
  }
  serialize = false;
  try {
    testDelete(verifier, data[6], checkerClient);
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('Failed: Delete account', e);
  }
};

const printUsage = () => {
  console.log('USAGE: node -r ts-node/register src/testVerifier.ts');
  process.exit(-1);
};

const callVerifier = () => {
  if (process.argv.length !== 2) {
    printUsage();
  }
  // For local testing
  process.env.SNODES = 'localhost:50051';
  const snodes = process.env.SNODES;
  let host: string;
  let port: string;
  if (snodes === undefined) {
    console.log('Undefined storage node');
    process.exit(-2);
  } else {
    const slist = snodes.split(',');
    host = slist[0].split(':')[0];
    port = slist[0].split(':')[1];
    console.log('Starting verifier at', host, ':', port, '\n');
    runVerifier(host, port);
  }
};

callVerifier();