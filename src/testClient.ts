import {hashAsBigInt, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import * as grpc from 'grpc';
import {RlpDecode, RlpList} from 'rlp-stream/build/src/rlp-stream';

import * as StorageNodeService from '../build/proto/clientStorage_grpc_pb';
import {AccountReply, AccountRequest, BlockHashReply, BlockHashRequest, CodeReply, CodeRequest, MerklePatriciaTreeNode, RPCWitness, StorageReply, StorageRequest} from '../build/proto/clientStorage_pb';

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
        'Test Sucess: getCodeInfo of existing account with codeOnly set to false');
    debugLog.write(
        'Test Sucess: getCodeInfo of existing account with codeOnly set to false');
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
        'Test Sucess: getCodeInfo of existing account with codeOnly set to true');
    debugLog.write(
        'Test Sucess: getCodeInfo of existing account with codeOnly set to true\n');
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
        'Test Sucess: getCodeInfo of non-existing account with codeOnly set to false');
    debugLog.write(
        'Test Sucess: getCodeInfo of non-existing account with codeOnly set to false\n');
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
        'Test Sucess: getCodeInfo of non-existing account with codeOnly set to true');
    debugLog.write(
        'Test Sucess: getCodeInfo of non-existing account with codeOnly set to true\n');
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
    console.log('Test Sucess: getAccount of existing account');
    debugLog.write('Test Sucess: getAccount of existing account\n');
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
    console.log('Test Sucess: getAccount of non-existing account');
    debugLog.write('Test Sucess: getAccount of non-existing account\n');
    debugLog.write(
        'Returns a undefined account with proof of non-existence \n');
    debugLog.write('-------------------------------------------------\n');
  });
};

const runTestClient = (port: string) => {
  const client = new StorageNodeService.StorageNodeClient(
      'localhost:' + port, grpc.credentials.createInsecure());

  // Test with RPC calls
  testGetCodeInfo(client);
  testGetAccount(client);
};

const printUsage = () => {
  console.log('USAGE: node -r ts-node/register src/testClient.ts port');
  process.exit(-1);
};

const callClient = () => {
  if (process.argv.length !== 3) {
    printUsage();
  }
  const port = process.argv[2];
  console.log('\nStarting client to connect server on port:', port);
  console.log('Debug Info in logs/testClient.log\n');
  runTestClient(port);
};

callClient();