import {AccountRequest, StorageNodeClient, StorageNodeService, StorageRequest, StorageUpdate, UpdateMsg, UpdateOp, VerifierStorageClient, VerifierStorageService} from '@rainblock/protocol';
import {toBigIntBE, toBufferBE} from 'bigint-buffer';
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

const testUpdateNewAccount = async (
    verifier: VerifierStorageClient, block: RlpList,
    client: StorageNodeClient) => {
  // create request

  const createOp = new UpdateOp();
  const address =
      Buffer.from('000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
  const bigIntBalance = BigInt(100);
  const balance = toBufferBE(bigIntBalance, 32);
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
  console.log('... Executing Create Request');
  verifier.update(updateMsg, (err, resp) => {
    if (err) {
      throw new Error('Update failed: Create Request');
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
      console.log('Test Success: Create verified');
      debugLog.write('Test Success: Create verified\n');
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
    console.log('Failed: CreateOp update');
  }
  serialize = false;
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