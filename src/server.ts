import {toBigIntBE} from 'bigint-buffer';
import * as grpc from 'grpc';
import {sendUnaryData, ServerUnaryCall} from 'grpc';

import {StorageNodeService} from '../build/proto/clientStorage_grpc_pb';
import {AccountReply, AccountRequest, BlockHashReply, BlockHashRequest, CodeReply, CodeRequest, MerklePatriciaTreeNode, RPCWitness, StorageReply, StorageRequest} from '../build/proto/clientStorage_pb';
import {VerifierStorageService} from '../build/proto/verifierStorage_grpc_pb';

import {StorageNode} from './index';

let storage: StorageNode;

const getCodeInfo =
    (call: ServerUnaryCall<CodeRequest>,
     callback: sendUnaryData<CodeReply>) => {
      // Log the request
      console.log('Received getCodeInfo Call');

      // unpack request
      const address = Buffer.from(call.request.getAddress() as Uint8Array);
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
          reply.setCode(code as Uint8Array);
        }
        callback(null, reply);
      } else {
        const reply = new CodeReply();
        const accountReply = new AccountReply();
        const nodeList = new Array<MerklePatriciaTreeNode>();
        const witness = new RPCWitness();
        if (account.value) {
          witness.setValue(account.value as Uint8Array);
        }
        for (let i = 0; i < account.proof.length; i++) {
          const treeNode = new MerklePatriciaTreeNode();
          treeNode.setEncoding(account.proof[i] as Uint8Array);
          nodeList.push(treeNode);
        }
        witness.setProofList(nodeList);
        accountReply.setExists(exists);
        accountReply.setWitness(witness);
        reply.setAccountInfo(accountReply);
        if (code) {
          reply.setCode(code as Uint8Array);
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
      const address = Buffer.from(call.request.getAddress() as Uint8Array);

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
        witness.setValue(ret.value as Uint8Array);
      }
      for (let i = 0; i < ret.proof.length; i++) {
        const treeNode = new MerklePatriciaTreeNode();
        treeNode.setEncoding(ret.proof[i] as Uint8Array);
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
      const address = Buffer.from(call.request.getAddress() as Uint8Array);
      const key = Buffer.from(call.request.getKey() as Uint8Array);

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
        witness.setValue(ret.value as Uint8Array);
      }
      const nodeList = new Array<MerklePatriciaTreeNode>();
      for (let i = 0; i < ret.proof.length; i++) {
        const treeNode = new MerklePatriciaTreeNode();
        treeNode.setEncoding(ret.proof[i] as Uint8Array);
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
      reply.setHashesList(ret as Uint8Array[]);
      callback(null, reply);
    };

const runServer = (shard: number, port: number) => {
  const server = new grpc.Server();
  server.addService(
      StorageNodeService, {getCodeInfo, getAccount, getStorage, getBlockHash});
  server.addService(VerifierStorageService, {});
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