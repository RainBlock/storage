import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, HashType} from 'bigint-hash';
import * as grpc from 'grpc';
import * as path from 'path';
import {RlpDecode, RlpDecoderTransform, RlpEncode, RlpList} from 'rlp-stream';

import * as VerifierStorageService from '../build/proto/verifierStorage_grpc_pb';
import {CreationOp, DeletionOp, ExecutionOp, StorageDeletion, StorageInsertion, StorageUpdate, UpdateMsg, UpdateOp, ValueChangeOp} from '../build/proto/verifierStorage_pb';

import {rlpToEthereumAccount} from './utils';

const wait = require('wait-for-stuff');
const fs = require('fs-extra');
const asyncChunks = require('async-chunks');

const BLOCK_FIRST10 = 'test_data/first10.bin';

const loadStream = async (filename: string) => {
  const decoder = new RlpDecoderTransform();
  fs.createReadStream(path.join(__dirname, filename)).pipe(decoder);
  return decoder;
};

const runVerifier = (host: string, port: string) => {
  const storageSocket = host + ':' + port;
  const verifier = new VerifierStorageService.VerifierStorageClient(
      storageSocket, grpc.credentials.createInsecure());

  const createOp = new CreationOp();
  const address =
      Buffer.from('000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
  let balance = toBufferBE(BigInt(100), 32);
  const code = address;
  const storageList = new Array<StorageInsertion>();
  let storage = new StorageInsertion();
  storage.setKey(address);
  storage.setValue(address);
  storageList.push(storage);

  createOp.setAccount(address);
  createOp.setValue(balance);
  createOp.setCode(code);
  createOp.setStorageList(storageList);

  const valOp = new ValueChangeOp();
  balance = toBufferBE(BigInt(500), 32);

  valOp.setAccount(address);
  valOp.setValue(balance);
  valOp.setChanges(1);

  const delOp = new DeletionOp();
  delOp.setAccount(address);

  const execOp = new ExecutionOp();
  balance = toBufferBE(BigInt(300), 32);
  const storageUpdateList = new Array<StorageUpdate>();
  let storageUpdate = new StorageUpdate();
  storage = new StorageInsertion();
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

  const updateMsg = new UpdateMsg();
  const data: RlpList[] = getData();
  console.log(data);
  // const rlpGenesis = RlpDecode(data) as RlpList;
  let rlpBlockBuffer = RlpEncode(data[1]) as Buffer;

  const opList = new Array<UpdateOp>();
  let updateOp = new UpdateOp();
  updateOp.setCreate(createOp);
  opList.push(updateOp);

  updateMsg.setMerkleTreeNodes('');
  updateMsg.setRlpBlock(rlpBlockBuffer);
  updateMsg.setOperationsList(opList);

  let barrier1 = true;
  let barrier2 = true;
  let barrier3 = true;
  let barrier4 = true;
  let barrier5 = true;
  verifier.update(updateMsg, (err, resp) => {
    console.log('Create Request finished');
    barrier1 = false;
  });

  wait.for.predicate(() => barrier1 === false);

  rlpBlockBuffer = RlpEncode(data[2]) as Buffer;
  updateMsg.setRlpBlock(rlpBlockBuffer);
  opList.shift();
  updateOp = new UpdateOp();
  updateOp.setValue(valOp);
  opList.push(updateOp);
  updateMsg.setOperationsList(opList);

  verifier.update(updateMsg, (err, resp) => {
    console.log('Value Request finished');
    barrier2 = false;
  });

  wait.for.predicate(() => barrier2 === false);

  rlpBlockBuffer = RlpEncode(data[3]) as Buffer;
  updateMsg.setRlpBlock(rlpBlockBuffer);
  opList.shift();
  updateOp = new UpdateOp();
  updateOp.setExecute(execOp);
  opList.push(updateOp);
  updateMsg.setOperationsList(opList);

  verifier.update(updateMsg, (err, resp) => {
    console.log('Execute Request finished');
    barrier3 = false;
  });

  wait.for.predicate(() => barrier3 === false);

  rlpBlockBuffer = RlpEncode(data[4]) as Buffer;
  updateMsg.setRlpBlock(rlpBlockBuffer);
  opList.shift();
  updateOp = new UpdateOp();
  updateOp.setDelete(delOp);
  opList.push(updateOp);
  updateMsg.setOperationsList(opList);

  verifier.update(updateMsg, (err, resp) => {
    console.log('Delete Request finished');
    barrier4 = false;
  });

  wait.for.predicate(() => barrier4 === false);

  rlpBlockBuffer = RlpEncode(data[5]) as Buffer;
  updateMsg.setRlpBlock(rlpBlockBuffer);
  opList.shift();
  updateOp = new UpdateOp();
  updateOp.setExecute(execOp);
  opList.push(updateOp);
  updateMsg.setOperationsList(opList);

  verifier.update(updateMsg, (err, resp) => {
    console.log('Execute Request finished');
    barrier5 = false;
  });
};

const printUsage = () => {
  console.log('USAGE: node -r ts-node/register src/testVerifier.ts');
  process.exit(-1);
};

function getData(): RlpList[] {
  const promdata = getEthereumBlocks();
  let data: RlpList[] = [];
  promdata.then((retdata) => {
    data = retdata;
  });
  wait.for.predicate(() => data.length === 10);
  return data;
}

const getEthereumBlocks = async () => {
  const rlpBlocks: RlpList[] = [];

  for await (const chunk of asyncChunks(await loadStream(BLOCK_FIRST10))) {
    rlpBlocks.push(chunk);
  }
  return rlpBlocks;
};

const callVerifier = () => {
  if (process.argv.length !== 2) {
    printUsage();
  }
  console.log(process.env);
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