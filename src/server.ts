import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {Empty} from 'google-protobuf/google/protobuf/empty_pb';
import * as grpc from 'grpc';
import {sendUnaryData, ServerUnaryCall} from 'grpc';
import {RlpDecode, RlpList} from 'rlp-stream/build/src/rlp-stream';

import {StorageNodeService} from '../build/proto/clientStorage_grpc_pb';
import {AccountReply, AccountRequest, BlockHashReply, BlockHashRequest, CodeReply, CodeRequest, MerklePatriciaTreeNode, RPCWitness, StorageReply, StorageRequest} from '../build/proto/clientStorage_pb';
import {VerifierStorageService} from '../build/proto/verifierStorage_grpc_pb';
import {UpdateMsg} from '../build/proto/verifierStorage_pb';

import {StorageNode} from './index';
import * as utils from './utils';


let storage: StorageNode;

const getCodeInfo =
    (call: ServerUnaryCall<CodeRequest>,
     callback: sendUnaryData<CodeReply>) => {
      // Log the request
      console.log('Received getCodeInfo Call');

      // unpack request
      const address = Buffer.from(call.request.getAddress_asU8());
      const codeOnly = call.request.getCodeOnly();

      // storage call
      let ret;
      try {
        ret = storage.getCode(address, codeOnly);
      } catch (e) {
        console.log('ERROR: getCodeInfo\n', e);
        callback(e, null);
        return;
      }
      const code = ret.code;
      const exists = (code) ? true : false;
      const account = ret.account;

      // pack reply
      if (!account) {
        const reply = new CodeReply();
        if (code) {
          reply.setCode(new Uint8Array(code));
        }
        callback(null, reply);
      } else {
        const reply = new CodeReply();
        const accountReply = new AccountReply();
        const nodeList = new Array<MerklePatriciaTreeNode>();
        const witness = new RPCWitness();
        if (account.value) {
          witness.setValue(new Uint8Array(account.value));
        }
        for (let i = 0; i < account.proof.length; i++) {
          const treeNode = new MerklePatriciaTreeNode();
          treeNode.setEncoding(new Uint8Array(account.proof[i]));
          nodeList.push(treeNode);
        }
        witness.setProofList(nodeList);
        accountReply.setExists(exists);
        accountReply.setWitness(witness);
        reply.setAccountInfo(accountReply);
        if (code) {
          reply.setCode(new Uint8Array(code));
        }
        callback(null, reply);
      }
    };

const getAccount =
    (call: ServerUnaryCall<AccountRequest>,
     callback: sendUnaryData<AccountReply>) => {
      // Log the request
      console.log('Received getAccount call');

      // unpack request
      const address = Buffer.from(call.request.getAddress_asU8());

      // storage call
      let ret;
      try {
        ret = storage.get(address);
      } catch (e) {
        console.log('ERROR: getAccount\n', e);
        callback(e, null);
        return;
      }
      const exists = (ret.value) ? true : false;

      // pack reply
      const reply = new AccountReply();
      reply.setExists(exists);
      const nodeList = new Array<MerklePatriciaTreeNode>();
      const witness = new RPCWitness();
      if (ret.value) {
        witness.setValue(new Uint8Array(ret.value));
      }
      for (let i = 0; i < ret.proof.length; i++) {
        const treeNode = new MerklePatriciaTreeNode();
        treeNode.setEncoding(new Uint8Array(ret.proof[i]));
        nodeList.push(treeNode);
      }
      witness.setProofList(nodeList);
      reply.setWitness(witness);
      callback(null, reply);
    };

const getStorage =
    (call: ServerUnaryCall<StorageRequest>,
     callback: sendUnaryData<StorageReply>) => {
      // Log the request
      console.log('Received getStorage call');

      // unpack request
      const address = Buffer.from(call.request.getAddress_asU8());
      const key = Buffer.from(call.request.getKey_asU8());

      // storage call
      let ret;
      try {
        ret = storage.getStorage(address, toBigIntBE(key));
      } catch (e) {
        console.log('ERROR: getStorage\n', e);
        callback(e, null);
        return;
      }

      // pack reply
      if (!ret) {
        callback(
            new Error('getStorage: No account with requested address'), null);
        return;
      }
      const reply = new StorageReply();
      const witness = new RPCWitness();
      if (ret.value) {
        witness.setValue(new Uint8Array(ret.value));
      }
      const nodeList = new Array<MerklePatriciaTreeNode>();
      for (let i = 0; i < ret.proof.length; i++) {
        const treeNode = new MerklePatriciaTreeNode();
        treeNode.setEncoding(new Uint8Array(ret.proof[i]));
        nodeList.push(treeNode);
      }
      witness.setProofList(nodeList);
      reply.setWitness(witness);
      callback(null, reply);
    };

const getBlockHash =
    (call: ServerUnaryCall<BlockHashRequest>,
     callback: sendUnaryData<BlockHashReply>) => {
      // Log the request
      console.log('Received getBlockHash call');

      // unpack request
      const blockNumber = BigInt(call.request.getNumber());

      // storage call
      let ret;
      try {
        ret = storage.getBlockHash(blockNumber);
      } catch (e) {
        console.log('ERROR getBlockHash\n', e);
        callback(e, null);
        return;
      }

      // pack reply
      const reply = new BlockHashReply();
      const retList = new Array<Uint8Array>();
      for (const hash of ret) {
        retList.push(new Uint8Array(toBufferBE(hash, 20)));
      }
      reply.setHashesList(retList);
      callback(null, reply);
    };

// TODO: Use the merkleNodes
const update =
    (call: ServerUnaryCall<UpdateMsg>, callback: sendUnaryData<Empty>) => {
      // Log request
      console.log('Received Update call');

      // unpack request;
      const block = Buffer.from(call.request.getRlpBlock_asU8());
      const rlpBlock = RlpDecode(block) as RlpList;
      const merkleNodes = Buffer.from(call.request.getMerkleTreeNodes_asU8());
      const opList = call.request.getOperationsList();
      const update: utils.UpdateOps = {ops: []};
      for (const item of opList) {
        if (item.hasCreate()) {
          const op = item.getCreate();
          if (!op) {
            continue;
          }
          const address = Buffer.from(op.getAccount_asU8());
          const balance = toBigIntBE(Buffer.from(op.getValue_asU8()));
          const code = Buffer.from(op.getCode_asU8());
          const accountStorage = new Map<bigint, bigint>();
          const storageList = op.getStorageList();
          for (const sop of storageList) {
            const key = toBigIntBE(Buffer.from(sop.getKey_asU8()));
            const val = toBigIntBE(Buffer.from(sop.getValue_asU8()));
            accountStorage.set(key, val);
          }
          const creationop: utils.CreationOp = {
            type: 'CreationOp',
            account: address,
            value: balance,
            code,
            storage: accountStorage,
          };
          update.ops.push(creationop);
        } else if (item.hasValue()) {
          const op = item.getValue();
          if (!op) {
            continue;
          }
          const address = Buffer.from(op.getAccount_asU8());
          const balance = toBigIntBE(Buffer.from(op.getValue_asU8()));
          const nonceChange = op.getChanges();
          const valuechangeop: utils.ValueChangeOp = {
            type: 'ValueChangeOp',
            account: address,
            value: balance,
            changes: nonceChange
          };
          update.ops.push(valuechangeop);

        } else if (item.hasExecute()) {
          const op = item.getExecute();
          if (!op) {
            continue;
          }
          const address = Buffer.from(op.getAccount_asU8());
          const balance = toBigIntBE(Buffer.from(op.getValue_asU8()));
          const accountStorage = new Array();
          const storageUpdateList = op.getStorageList();
          for (const sopItem of storageUpdateList) {
            if (sopItem.hasInserts()) {
              const sop = sopItem.getInserts();
              if (!sop) {
                continue;
              }
              const key = toBigIntBE(Buffer.from(sop.getKey_asU8()));
              const val = toBigIntBE(Buffer.from(sop.getValue_asU8()));
              const sopupdate:
                  utils.StorageInsertion = {type: 'StorageInsertion', key, val};
              accountStorage.push(sopupdate);

            } else if (sopItem.hasDeletes()) {
              const sop = sopItem.getDeletes();
              if (!sop) {
                continue;
              }
              const key = toBigIntBE(Buffer.from(sop.getKey_asU8()));
              const sopdelete:
                  utils.StorageDeletion = {type: 'StorageDeletion', key};
              accountStorage.push(sopdelete);
            }
          }
          const executionop: utils.ExecutionOp = {
            type: 'ExecutionOp',
            account: address,
            value: balance,
            storageUpdates: accountStorage
          };
          update.ops.push(executionop);

        } else if (item.hasDelete()) {
          const op = item.getDelete();
          if (!op) {
            continue;
          }
          const address = Buffer.from(op.getAccount_asU8());
          const deleteop: utils.DeletionOp = {
            type: 'DeletionOp',
            account: address,
          };
          update.ops.push(deleteop);
        }
      }
      // storage call;
      try {
        storage.update(rlpBlock, update);
      } catch (e) {
        console.log('ERROR: update\n', e);
        callback(e, new Empty());
        return;
      }
      callback(null, new Empty());
    };

const runServer = (shard: number, port: number) => {
  const server = new grpc.Server();
  server.addService(
      StorageNodeService, {getCodeInfo, getAccount, getStorage, getBlockHash});
  server.addService(VerifierStorageService, {update});
  server.bind(
      '0.0.0.0:' + port.toString(), grpc.ServerCredentials.createInsecure());
  server.start();
  console.log('grpc server running on at 0.0.0.0:' + port.toString());
};

const printUsage = () => {
  console.log('USAGE: ts-node src/server.ts shard port');
  console.log('shard: number in range(0, 15) or -1 for fullNode');
  console.log(' port: port to run the storage server on');
  process.exit(-1);
};

const callServer = () => {
  if (process.argv.length !== 4) {
    printUsage();
  }
  const shard: number = Number(process.argv[2]);
  const port: number = Number(process.argv[3]);
  console.log('Received shard and port: ', shard, port);
  if (shard !== -1 && (shard < 0 || shard > 15)) {
    printUsage();
  }
  storage = new StorageNode(shard);
  runServer(shard, port);
};

callServer();