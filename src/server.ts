import {MerklePatriciaTree} from '@rainblock/merkle-patricia-tree/build/src';
import {AccountReply, AccountRequest, BlockHashReply, BlockHashRequest, CodeReply, CodeRequest, RPCWitness, StorageNodeService, StorageReply, StorageRequest, UpdateMsg, VerifierStorageService} from '@rainblock/protocol';
import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import * as fs from 'fs';
import {Empty} from 'google-protobuf/google/protobuf/empty_pb';
import * as grpc from 'grpc';
import {sendUnaryData, ServerUnaryCall} from 'grpc';
import * as yaml from 'js-yaml';
import * as path from 'path';
import {RlpDecode, RlpList} from 'rlp-stream/build/src/rlp-stream';

import {ConfigurationFile, StorageShards} from './configFile';
import {StorageNode} from './index';
import * as utils from './utils';

let storage: StorageNode;
const serializer = new MerklePatriciaTree();

const getCodeInfo = async (
    call: ServerUnaryCall<CodeRequest>, callback: sendUnaryData<CodeReply>) => {
  // unpack request
  const address = Buffer.from(call.request.getAddress_asU8());
  const codeOnly = call.request.getCodeOnly();

  // storage call
  const prom = storage.getCode(address, codeOnly);
  prom.then((ret) => {
        const code = ret.code;
        const exists = (code) ? true : false;

        // pack reply
        if (!ret.account) {
          const reply = new CodeReply();
          if (code) {
            reply.setCode(new Uint8Array(code));
          }
          callback(null, reply);
        } else {
          const account = serializer.rlpSerializeWitness(ret.account);
          const reply = new CodeReply();
          const accountReply = new AccountReply();
          const witness = new RPCWitness();
          if (account.value) {
            witness.setValue(new Uint8Array(account.value));
          }
          witness.setProofListList(account.proof);
          accountReply.setExists(exists);
          accountReply.setWitness(witness);
          reply.setAccountInfo(accountReply);
          if (code) {
            reply.setCode(new Uint8Array(code));
          }
          callback(null, reply);
        }
      })
      .catch((e) => {
        console.log('ERROR: getCodeInfo\n', e);
        callback(e, null);
        return;
      });
};

const getAccount = async (
    call: ServerUnaryCall<AccountRequest>,
    callback: sendUnaryData<AccountReply>) => {
  // unpack request
  const address = Buffer.from(call.request.getAddress_asU8());

  // storage call
  const prom = storage.get(address);
  prom.then((ret) => {
        const exists = (ret.value) ? true : false;

        // pack reply
        const account = serializer.rlpSerializeWitness(ret);
        const reply = new AccountReply();
        reply.setExists(exists);
        const witness = new RPCWitness();
        if (account.value) {
          witness.setValue(new Uint8Array(account.value));
        }
        witness.setProofListList(account.proof);
        reply.setWitness(witness);
        callback(null, reply);
      })
      .catch((e) => {
        console.log('ERROR: getAccount\n', e);
        callback(e, null);
        return;
      });
};

const getStorage = async (
    call: ServerUnaryCall<StorageRequest>,
    callback: sendUnaryData<StorageReply>) => {
  // unpack request
  const address = Buffer.from(call.request.getAddress_asU8());
  const key = Buffer.from(call.request.getKey_asU8());

  // storage call
  const prom = storage.getStorage(address, toBigIntBE(key));
  prom.then((ret) => {
        // pack reply
        if (!ret) {
          callback(
              new Error('getStorage: No account with requested address'), null);
          return;
        }
        const reply = new StorageReply();
        const accStorage = serializer.rlpSerializeWitness(ret);
        const witness = new RPCWitness();
        if (accStorage.value) {
          witness.setValue(new Uint8Array(accStorage.value));
        }
        witness.setProofListList(accStorage.proof);
        reply.setWitness(witness);
        callback(null, reply);
      })
      .catch((e) => {
        console.log('ERROR: getStorage\n', e);
        callback(e, null);
        return;
      });
};

const getBlockHash = async (
    call: ServerUnaryCall<BlockHashRequest>,
    callback: sendUnaryData<BlockHashReply>) => {
  // unpack request
  const blockNumber = BigInt(call.request.getNumber());

  // storage call
  const prom = storage.getBlockHash(blockNumber);
  prom.then((ret) => {
        // pack reply
        const reply = new BlockHashReply();
        const retList = new Array<Uint8Array>();
        for (const hash of ret) {
          retList.push(new Uint8Array(toBufferBE(hash, 20)));
        }
        reply.setHashesList(retList);
        callback(null, reply);
      })
      .catch((e) => {
        console.log('ERROR getBlockHash\n', e);
        callback(e, null);
        return;
      });
};

const update = async (
    call: ServerUnaryCall<UpdateMsg>, callback: sendUnaryData<Empty>) => {
  // unpack request;
  const block = Buffer.from(call.request.getRlpBlock_asU8());
  const rlpBlock = RlpDecode(block) as RlpList;
  const merkleNodes = Buffer.from(call.request.getMerkleTreeNodes_asU8());
  const opList = call.request.getOperationsList();
  const update: utils.UpdateOps[] = [];
  for (const item of opList) {
    const storage: utils.StorageUpdates[]|undefined = [];
    const storageList = item.getStorageUpdateList();
    for (const sop of storageList) {
      storage.push({
        key: toBigIntBE(Buffer.from(sop.getKey_asU8())),
        value: toBigIntBE(Buffer.from(sop.getValue_asU8()))
      });
    }
    const balance = toBigIntBE(Buffer.from(item.getBalance_asU8()));
    const nonce = BigInt(item.getNonce());
    const code = Buffer.from(item.getCode_asU8());
    const op: utils.UpdateOps = {
      account: Buffer.from(item.getAccount_asU8()),
      balance: (balance || balance === 0n) ? balance : undefined,
      nonce: (nonce || nonce === 0n) ? nonce : undefined,
      code: (code) ? code : undefined,
      storage: (storage && storage.length) ? storage : undefined,
      deleted: (item.getDeleted()) ? true : false,
    };
    update.push(op);
  }
  // storage call;
  let prom: Promise<void>;
  if (merkleNodes.length === 0) {
    prom = storage.update(rlpBlock, update);
  } else {
    prom = storage.update(rlpBlock, update, merkleNodes);
  }
  prom.then((ret) => {}).catch((e) => {
    console.log('ERROR: update\n', e);
    callback(e, new Empty());
    return;
  });
  callback(null, new Empty());
};

const printUsage = () => {
  console.log('USAGE: ts-node src/server.ts shard config');
  console.log('shard: number in range(0, 15) or -1 for fullNode');
  console.log('config: relative path to config from src directory');
  console.log('Sample config file in src/test_data/config.yml');
  process.exit(-1);
};

const callServer = async () => {
  // The cmd line argument should be a relative path from the __dirname
  const file =
      (process.argv.length === 4) ? process.argv[3] : 'test_data/config.yml';
  const filePath = path.join(__dirname, file);
  const config = yaml.safeLoad(await fs.promises.readFile(filePath, 'utf8')) as
      ConfigurationFile;

  shards = config.shards;
  shard = Number(process.argv[2]);
  if (shard < -1 || shard > 15) {
    printUsage();
  }
  storage = new StorageNode(shard, config.genesisData, config.genesisBlock);
  const server = new grpc.Server({
    'grpc.max_send_message_length': config.maxMsgSendLength,
    'grpc.max_receive_message_length': config.maxMsgReceiveLength
  });
  server.addService(
      StorageNodeService, {getCodeInfo, getAccount, getStorage, getBlockHash});
  server.addService(VerifierStorageService, {update});
  server.bind(shards[shard], grpc.ServerCredentials.createInsecure());
  server.start();
};

let shard: number;
let shards: StorageShards;
callServer().then(() => {
  console.log('Storage shard ' + shard + ' running on ' + shards[shard]);
});