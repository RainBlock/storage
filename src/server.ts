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

let pruneDepth: number;
let shard: number;
let shards: StorageShards;

const getCodeInfo = async (
    call: ServerUnaryCall<CodeRequest>, callback: sendUnaryData<CodeReply>) => {
  const start = process.hrtime.bigint();
  // unpack request
  const address = await u8ToBuffer(call.request.getAddress_asU8());
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
          // remove the first pruneDepth levels from witness
          const proofLength = ret.account.proof.length;
          if (proofLength > pruneDepth) {
            ret.account.proof = ret.account.proof.slice(pruneDepth);
          } else {
            ret.account.proof = ret.account.proof.slice(-1);
          }
          // pack reply
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
          const end = process.hrtime.bigint();
          callback(null, reply);
          console.log(`witPercentage: ${
              (proofLength - account.proof.length) * 100 / proofLength}, original: ${
              proofLength}, reduced: ${account.proof.length}`);
          console.log(`getCode: ${end - start} ns`);
        }
      })
      .catch((e) => {
        console.log('ERROR: getCodeInfo\n', e);
        callback(e, null);
        return;
      });
};

const u8ToHexString = async (byteArray: Uint8Array) => {
  let hexString = '';
  const length = byteArray.length;
  for (let i = 0; i < byteArray.length; i++) {
    hexString += (byteArray[i] & 0xf0).toString(16)[0];
    hexString += (byteArray[i] & 0x0f).toString(16);
  }
  return hexString;
};

const u8ToBigInt = async (byteArray: Uint8Array) => {
  const hexString = await u8ToHexString(byteArray);
  if (hexString.length === 0) {
    return 0n;
  }
  return BigInt(`0x${hexString}`);
};

const u8ToBuffer = async (byteArray: Uint8Array) => {
  const length = byteArray.length;
  const bigintBuffer = await u8ToBigInt(byteArray);
  return toBufferBE(bigintBuffer, length);
};

const getAccount = async (
    call: ServerUnaryCall<AccountRequest>,
    callback: sendUnaryData<AccountReply>) => {
  const start = process.hrtime.bigint();
  // unpack request
  const address = await u8ToBuffer(call.request.getAddress_asU8());

  // storage call
  const prom = storage.get(address);
  prom.then((ret) => {
        const exists = (ret.value) ? true : false;

        // remove the first pruneDepth levels from witness
        const proofLength = ret.proof.length;
        if (proofLength > pruneDepth) {
          ret.proof = ret.proof.slice(pruneDepth);
        } else {
          ret.proof = ret.proof.slice(-1);
        }
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
        const end = process.hrtime.bigint();
        callback(null, reply);
        console.log(`witPercentage: ${
            (proofLength - account.proof.length) * 100 / proofLength}, original: ${
            proofLength}, reduced: ${account.proof.length}`);
        console.log(`getAccount: ${end - start} ns`);
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
  const start = process.hrtime.bigint();
  const address = await u8ToBuffer(call.request.getAddress_asU8());
  const key = await u8ToBuffer(call.request.getKey_asU8());

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
        const end = process.hrtime.bigint();
        callback(null, reply);
        console.log(`getStorage: ${end - start} ns`);
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
  const start = process.hrtime.bigint();
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
        const end = process.hrtime.bigint();
        callback(null, reply);
        console.log(`getBlockHash: ${end - start} ns`);
      })
      .catch((e) => {
        console.log('ERROR getBlockHash\n', e);
        callback(e, null);
        return;
      });
};

const update = async (
    call: ServerUnaryCall<UpdateMsg>, callback: sendUnaryData<Empty>) => {
  const start = process.hrtime.bigint();
  // unpack request;
  const block = await u8ToBuffer(call.request.getRlpBlock_asU8());
  const rlpBlock = RlpDecode(block) as RlpList;
  const merkleNodes = await u8ToBuffer(call.request.getMerkleTreeNodes_asU8());
  const opList = call.request.getOperationsList();
  const update: utils.UpdateOps[] = [];
  for (const item of opList) {
    const storage: utils.StorageUpdates[]|undefined = [];
    const storageList = item.getStorageUpdateList();
    for (const sop of storageList) {
      storage.push({
        key: await u8ToBigInt(sop.getKey_asU8()),
        value: await u8ToBigInt(sop.getValue_asU8())
      });
    }
    const balance = await u8ToBigInt(item.getBalance_asU8());
    const nonce = BigInt(item.getNonce());
    const code = await u8ToBuffer(item.getCode_asU8());
    const op: utils.UpdateOps = {
      account: await u8ToBuffer(item.getAccount_asU8()),
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
  const end = process.hrtime.bigint();
  callback(null, new Empty());
  console.log(`Update: ${end - start} ns`);
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
  pruneDepth = config.pruneDepth;
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

callServer().then(() => {
  console.log('Storage shard ' + shard + ' running on ' + shards[shard]);
});
