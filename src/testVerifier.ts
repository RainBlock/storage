import {toBufferBE} from 'bigint-buffer';
import * as grpc from 'grpc';
import * as path from 'path';
import {RlpDecode, RlpDecoderTransform, RlpEncode, RlpList} from 'rlp-stream';

import * as StorageNodeService from '../build/proto/clientStorage_grpc_pb';
import {AccountRequest, BlockHashRequest, CodeRequest, StorageRequest} from '../build/proto/clientStorage_pb';
import * as VerifierStorageService from '../build/proto/verifierStorage_grpc_pb';
import {CreationOp, DeletionOp, ExecutionOp, StorageDeletion, StorageInsertion, StorageUpdate, UpdateMsg, UpdateOp, ValueChangeOp} from '../build/proto/verifierStorage_pb';

import {EthereumAccount, rlpToEthereumAccount} from './utils';

const wait = require('wait-for-stuff');
const fs = require('fs-extra');
const asyncChunks = require('async-chunks');


const debugLog = fs.createWriteStream('./logs/testClient.log', {flags: 'a'});
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

// TODO: Can have one async function to readBlocks
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

const checkResponse =
    (client: StorageNodeService.StorageNodeClient, address: Buffer,
     balance: bigint, testname: string) => {
      const request = new AccountRequest();
      request.setAddress(address);
      client.getAccount(request, (err, response) => {
        if (err) {
          if (testname === 'deleteTest') {
            console.log('Test Success: ' + testname + '\n');
            debugLog.write('Account correctly deleted:\n');
          } else {
            throw new Error('Error in getAccount rpc');
          }
        } else {
          // unpack response
          const accountVal =
              Buffer.from(response.getWitness()!.getValue_asU8());
          const rlpAccount = RlpDecode(accountVal) as RlpList;
          const account = rlpToEthereumAccount(rlpAccount);

          // check correctness
          // assertEquals(account.nonce, nonce);
          assertEquals(account.balance, balance);
          // assertEquals(account.codeHash, codeHash);
          // assertEquals(account.storageRoot, storageRoot);

          // Logging Information
          console.log('Test Success: ' + testname + '\n');
          debugLog.write('Account:\n');
          debugLog.write(account.balance.toString() + '\n');
          debugLog.write(account.nonce.toString() + '\n');
          debugLog.write(account.codeHash.toString() + '\n');
          debugLog.write(account.storageRoot.toString() + '\n');
          debugLog.write('-------------------------------------------------\n');
        }
      });
    };

const testCreateOp =
    (verifier: VerifierStorageService.VerifierStorageClient, block: RlpList,
     client: StorageNodeService.StorageNodeClient, testname: string) => {
      // create request
      const createOp = new CreationOp();
      const address =
          Buffer.from('000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
      const bigIntBalance = BigInt(100);
      const balance = toBufferBE(bigIntBalance, 32);
      const code = address;
      const storageList = new Array<StorageInsertion>();
      const storage = new StorageInsertion();
      storage.setKey(address);
      storage.setValue(address);
      storageList.push(storage);
      createOp.setAccount(address);
      createOp.setValue(balance);
      createOp.setCode(code);
      createOp.setStorageList(storageList);

      // pack request
      const updateMsg = new UpdateMsg();
      const opList = new Array<UpdateOp>();
      const updateOp = new UpdateOp();
      updateOp.setCreate(createOp);
      opList.push(updateOp);
      updateMsg.setRlpBlock(RlpEncode(block) as Buffer);
      updateMsg.setOperationsList(opList);

      // storage update
      verifier.update(updateMsg, (err, resp) => {
        if (err) {
          throw new Error('Update failed: Create Request');
        }
        checkResponse(client, address, bigIntBalance, testname);
        console.log('Test Success: Create Request');
        serialize = true;
      });
    };

const testValueOp =
    (verifier: VerifierStorageService.VerifierStorageClient, block: RlpList,
     client: StorageNodeService.StorageNodeClient, testname: string) => {
      // create request
      const address =
          Buffer.from('000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
      const valOp = new ValueChangeOp();
      const bigIntBalance = BigInt(500);
      const balance = toBufferBE(bigIntBalance, 32);
      valOp.setAccount(address);
      valOp.setValue(balance);
      valOp.setChanges(1);

      // pack request
      const updateMsg = new UpdateMsg();
      const opList = new Array<UpdateOp>();
      const updateOp = new UpdateOp();
      updateOp.setValue(valOp);
      opList.push(updateOp);
      updateMsg.setRlpBlock(RlpEncode(block) as Buffer);
      updateMsg.setOperationsList(opList);

      // storage update
      verifier.update(updateMsg, (err, resp) => {
        if (err) {
          throw new Error('Update failed: Value Request');
        }
        checkResponse(client, address, bigIntBalance, testname);
        console.log('Test Success: Value Request');
        serialize = true;
      });
    };

const testDeleteOp =
    (verifier: VerifierStorageService.VerifierStorageClient, block: RlpList,
     client: StorageNodeService.StorageNodeClient, testname: string) => {
      // create request
      const address =
          Buffer.from('000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
      const delOp = new DeletionOp();
      delOp.setAccount(address);

      // pack request
      const updateMsg = new UpdateMsg();
      const opList = new Array<UpdateOp>();
      const updateOp = new UpdateOp();
      updateOp.setDelete(delOp);
      opList.push(updateOp);
      updateMsg.setRlpBlock(RlpEncode(block) as Buffer);
      updateMsg.setOperationsList(opList);

      // storage update
      verifier.update(updateMsg, (err, resp) => {
        if (err) {
          throw new Error('Update failed: Delete Request');
        }
        checkResponse(client, address, BigInt(0), testname);
        console.log('Test Success: Delete Request');
        serialize = true;
      });
    };

const testExecutionOp =
    (verifier: VerifierStorageService.VerifierStorageClient, block: RlpList,
     client: StorageNodeService.StorageNodeClient, testname: string) => {
      // create request
      const address =
          Buffer.from('000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
      const execOp = new ExecutionOp();
      const bigIntBalance = BigInt(300);
      const balance = toBufferBE(bigIntBalance, 32);
      const storageUpdateList = new Array<StorageUpdate>();
      let storageUpdate = new StorageUpdate();
      const storage = new StorageInsertion();
      storage.setKey(Buffer.from('000b', 'hex'));
      storage.setValue(address);
      storageUpdate.setInserts(storage);
      storageUpdateList.push(storageUpdate);
      const storageDel = new StorageDeletion();
      storageDel.setKey(address);
      storageUpdate = new StorageUpdate();
      storageUpdate.setDeletes(storageDel);
      storageUpdateList.push(storageUpdate);
      execOp.setAccount(address);
      execOp.setValue(balance);
      execOp.setStorageList(storageUpdateList);

      // pack request
      const updateMsg = new UpdateMsg();
      const opList = new Array<UpdateOp>();
      const updateOp = new UpdateOp();
      updateOp.setExecute(execOp);
      opList.push(updateOp);
      updateMsg.setRlpBlock(RlpEncode(block) as Buffer);
      updateMsg.setOperationsList(opList);

      // storage update
      verifier.update(updateMsg, (err, resp) => {
        if (err) {
          throw new Error('Update failed: Execute Request');
        }
        checkResponse(client, address, bigIntBalance, testname);
        if (!resp) {
          throw new Error('Update failed: Execute Request');
        }
        console.log('Test Sucess: Execute Request');
        serialize = true;
      });
    };

const runVerifier = (host: string, port: string) => {
  const storageSocket = host + ':' + port;
  const verifier = new VerifierStorageService.VerifierStorageClient(
      storageSocket, grpc.credentials.createInsecure());
  const checkerClient = new StorageNodeService.StorageNodeClient(
      storageSocket, grpc.credentials.createInsecure());

  // Get the data required
  const data: RlpList[] = getData();

  // Test server update RPC
  try {
    testCreateOp(verifier, data[1], checkerClient, 'createTest');
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('Failed: CreateOp update');
  }
  serialize = false;
  try {
    testValueOp(verifier, data[2], checkerClient, 'valChangeTest');
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('Failed: ValueOp update');
  }
  serialize = false;
  try {
    testExecutionOp(verifier, data[3], checkerClient, 'executeTest');
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('Failed: ExecutionOp update');
  }
  serialize = false;
  try {
    testDeleteOp(verifier, data[4], checkerClient, 'deleteTest');
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('Failed: DeletionOp update');
  }
  serialize = false;
  try {
    testExecutionOp(verifier, data[5], checkerClient, 'execFailTest');
    wait.for.predicate(() => serialize);
  } catch (e) {
    console.log('Test Success: Execute should fail');
    return;
  }
  throw new Error('ERROR: Last ExecuteOp should fail');
};

const printUsage = () => {
  console.log('USAGE: node -r ts-node/register src/testVerifier.ts');
  process.exit(-1);
};

const callVerifier = () => {
  if (process.argv.length !== 2) {
    printUsage();
  }
  const snodes = process.env.SNODES;
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
    console.log('Starting verifier at', host, ':', port);
    runVerifier(host, port);
  }
};

callVerifier();