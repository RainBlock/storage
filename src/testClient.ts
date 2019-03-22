import {hashAsBigInt, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import * as grpc from 'grpc';
import {RlpDecode, RlpList} from 'rlp-stream/build/src/rlp-stream';

import * as StorageNodeService from '../build/proto/clientStorage_grpc_pb';
import {AccountRequest, BlockHashRequest, CodeRequest, StorageRequest} from '../build/proto/clientStorage_pb';

import {EthereumAccount, rlpToEthereumAccount} from './utils';

const debugLog = fs.createWriteStream('./logs/testClient.log', {flags: 'a'});
const assertEquals = (n0: bigint, n1: bigint) => {
  if (n0 !== n1) {
    let errorString = 'AssertionError!\n';
    errorString += 'Received: ' + n0.toString() + '\n';
    errorString += 'Expected: ' + n1.toString() + '\n';
    throw new Error(errorString);
  }
};

const testGetCodeInfo = (client: StorageNodeService.StorageNodeClient) => {
  // Test getCodeInfo of existing account with code only set to false;
  const addr = Buffer.from('000d836201318ec6899a67540690382780743280', 'hex');
  const correctAccount: EthereumAccount = {
    balance: 200000000000000000000n,
    nonce: 0n,
    codeHash: BigInt(
        '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'),
    storageRoot: BigInt(
        '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421'),
  };
  const request = new CodeRequest();
  request.setAddress(addr);
  request.setCodeOnly(false);

  client.getCodeInfo(request, (err, response) => {
    if (err) {
      throw new Error('Error in getCodeInfo rpc');
    }
    // unpack response
    const accountInfo = response.getAccountInfo();
    const rlpaccount = Buffer.from(accountInfo!.getWitness()!.getValue_asU8());
    const account = rlpToEthereumAccount(RlpDecode(rlpaccount) as RlpList);
    const code = Buffer.from(response.getCode_asU8());

    // Check response correctness
    assertEquals(account.balance, correctAccount.balance);
    assertEquals(account.nonce, correctAccount.nonce);
    assertEquals(account.codeHash, correctAccount.codeHash);
    assertEquals(account.storageRoot, correctAccount.storageRoot);

    // Logging Information
    console.log(
        'Test Success: getCodeInfo of existing account with codeOnly set to false');
    debugLog.write(
        'Test Success: getCodeInfo of existing account with codeOnly set to false');
    debugLog.write('Received CodeInfo:\n');
    debugLog.write('Account:\n');
    debugLog.write(account.balance.toString() + '\n');
    debugLog.write(account.nonce.toString() + '\n');
    debugLog.write(account.codeHash.toString() + '\n');
    debugLog.write(account.storageRoot.toString() + '\n');
    debugLog.write('-------------------------------------------------\n');
  });

  // Test getCodeInfo with existing Account with codeOnly set to true
  request.setCodeOnly(true);
  client.getCodeInfo(request, (err, response) => {
    if (err) {
      throw new Error('Error in getCodeInfo rpc');
    }
    // unpack response
    const code = Buffer.from(response.getCode_asU8());
    const noAccount = response.getAccountInfo();
    const codeHash = hashAsBigInt(HashType.KECCAK256, code);

    // check response correctness
    if (noAccount) {
      throw new Error('Received account when codeOnly is true');
    }
    assertEquals(
        codeHash,
        BigInt(
            '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'));

    // Logging information
    console.log(
        'Test Success: getCodeInfo of existing account with codeOnly set to true');
    debugLog.write(
        'Test Success: getCodeInfo of existing account with codeOnly set to true\n');
    debugLog.write('Received CodeInfo:\n');
    debugLog.write('CodeHash: ' + codeHash.toString() + '\n');
    debugLog.write('-------------------------------------------------\n');
  });

  // Test getCodeInfo with non existing Account with codeOnly set to false
  const noAddr = Buffer.from('000abcdefabcdefabcdef0001234567890abcdef', 'hex');
  const noRequest = new CodeRequest();
  noRequest.setCodeOnly(false);
  client.getCodeInfo(noRequest, (err, noResponse) => {
    if (err) {
      throw new Error('Error in getCodeInfo rpc');
    }
    // unpack response
    const account = noResponse.getAccountInfo();
    const exists = account!.getExists();
    const accountVal = account!.getWitness()!.getValue();

    // check correctness
    if (exists || accountVal) {
      console.log(exists, accountVal);
      throw new Error('Sending an account reply for non-existing account');
    }

    // Logging Information
    console.log(
        'Test Success: getCodeInfo of non-existing account with codeOnly set to false');
    debugLog.write(
        'Test Success: getCodeInfo of non-existing account with codeOnly set to false\n');
    const booleanString = (exists) ? 'true' : 'false';
    debugLog.write('Account exists: ' + booleanString + '\n');
    debugLog.write('-------------------------------------------------\n');
  });

  // Test getCodeInfo with non existing Account with codeOnly set to true
  noRequest.setAddress(noAddr);
  noRequest.setCodeOnly(true);
  client.getCodeInfo(noRequest, (err, noResponse) => {
    if (err) {
      throw new Error('Error in getCodeInfo rpc');
    }

    // unpack and check correctness
    const account = noResponse.getAccountInfo();
    if (account) {
      throw new Error('Received account with codeOnly set to true');
    }

    // Logging Information
    console.log(
        'Test Success: getCodeInfo of non-existing account with codeOnly set to true');
    debugLog.write(
        'Test Success: getCodeInfo of non-existing account with codeOnly set to true\n');
    debugLog.write('Account is undefined\n');
    debugLog.write('-------------------------------------------------\n');
  });
};

const testGetAccount = (client: StorageNodeService.StorageNodeClient) => {
  const address =
      Buffer.from('000d836201318ec6899a67540690382780743280', 'hex');
  const balance = BigInt(200000000000000000000);
  const nonce = BigInt(0);
  const codeHash = BigInt(
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  const storageRoot = BigInt(
      '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421');

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
    assertEquals(account.balance, balance);
    assertEquals(account.codeHash, codeHash);
    assertEquals(account.storageRoot, storageRoot);

    // Logging Information
    console.log('Test Success: getAccount of existing account');
    debugLog.write('Test Success: getAccount of existing account\n');
    debugLog.write('Account:\n');
    debugLog.write(account.balance.toString() + '\n');
    debugLog.write(account.nonce.toString() + '\n');
    debugLog.write(account.codeHash.toString() + '\n');
    debugLog.write(account.storageRoot.toString() + '\n');
    debugLog.write('-------------------------------------------------\n');
  });

  // Test getAccount of non-existing account
  const noAddress =
      Buffer.from('000abcdefabcdefabcdef0001234567890abcdef', 'hex');
  request.setAddress(noAddress);
  client.getAccount(request, (error, response) => {
    // unpack response
    const account = response.getWitness();
    const accountVal = account!.getValue();

    // check correctness
    if (accountVal) {
      throw new Error('Sending an account reply for non-existing account');
    }

    // Logging Information
    console.log('Test Success: getAccount of non-existing account');
    debugLog.write('Test Success: getAccount of non-existing account\n');
    debugLog.write(
        'Returns a undefined account with proof of non-existence \n');
    debugLog.write('-------------------------------------------------\n');
  });
};

const testGetStorage = (client: StorageNodeService.StorageNodeClient) => {
  // Test getStorage of non-existing account
  const noAddress =
      Buffer.from('000abcdefabcdefabcdef0001234567890abcdef', 'hex');
  const request = new StorageRequest();
  request.setAddress(noAddress);
  request.setKey(noAddress);

  client.getStorage(request, (err, response) => {
    if (response) {
      throw new Error('getStorage: response exists for a non-existing account');
    }
    console.log(
        'Test Success: getStorage response to non-existing account is undefined');
  });

  const address =
      Buffer.from('000d836201318ec6899a67540690382780743280', 'hex');
  request.setAddress(address);
  request.setKey(address);
  client.getStorage(request, (err, response) => {
    const account = response.getWitness();
    const value = response.getWitness()!.getValue();
    if (!account || value) {
      throw new Error(
          'getStorage: account should exist but value should not be present');
    }
    console.log(
        'Test Success: getStorage of existing account but non-existing storage key');
  });
};

const testGetBlockHash = (client: StorageNodeService.StorageNodeClient) => {
  const blockInValid = 1;
  const request = new BlockHashRequest();
  request.setNumber(blockInValid);
  client.getBlockHash(request, (err, response) => {
    const block = response.getHashesList();
    if (block.length !== 0) {
      throw new Error('getBlockHash: Has response for invalid blocknumber');
    }
    console.log(
        'Test Success: getBlockHash has no response for invalid blocknumber');
  });

  const blockValid = 0;
  request.setNumber(blockValid);
  client.getBlockHash(request, (err, response) => {
    const block = response.getHashesList();
    if (block.length === 0) {
      throw new Error('getBlockHash: Has response for invalid blocknumber');
    }
    console.log(
        'Test Success: getBlockHash has valid response for valid blocknumber');
  });
};

const runTestClient = (host: string, port: string) => {
  const storageSocket = host + ':' + port;
  const client = new StorageNodeService.StorageNodeClient(
      storageSocket, grpc.credentials.createInsecure());

  // Test with RPC calls
  testGetCodeInfo(client);
  testGetAccount(client);
  testGetStorage(client);
  testGetBlockHash(client);
};

const printUsage = () => {
  console.log('USAGE: node -r ts-node/register src/testClient.ts');
  process.exit(-1);
};

const callClient = () => {
  if (process.argv.length !== 2) {
    printUsage();
  }

  const snodes = process.env.SNODES;
  const enodes = process.env.ENODES;
  let host: string;
  let port: string;
  if (snodes === undefined) {
    console.log('Undefined storage node');
    process.exit(-2);
  } else {
    const slist = snodes.split(',');
    console.log(slist);
    host = slist[0].split(':')[0];
    port = slist[0].split(':')[1];
    console.log('\nStarting client to connect server at:' + host + ':' + port);
    console.log('Debug Info in logs/testClient.log\n');
    runTestClient(host, port);
  }
};

callClient();