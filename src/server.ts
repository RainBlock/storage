import {StorageNodeService} from "../build/proto/clientStorage_grpc_pb";
import {StorageNode} from './index';
import * as grpc from 'grpc';
import {ServerUnaryCall, sendUnaryData} from 'grpc';
import {
  CodeRequest,
  CodeReply,
  AccountRequest,
  AccountReply,
  StorageRequest,
  StorageReply,
  BlockHashRequest,
  BlockHashReply,
  MerklePatriciaTreeNode,
  RPCWitness
} from "../build/proto/clientStorage_pb";

function runServer(shard: number, port: number) {
  const storage = new StorageNode(shard);
  const server = new grpc.Server();
  server.addService(StorageNodeService,{}); 
    // { getCodeInfo: GetCodeInfo, getAccount: GetAccount, getStorage: GetStorage, getBlockHash: GetBlockHash });
  server.bind("0.0.0.0:" + port.toString(), grpc.ServerCredentials.createInsecure());
  server.start();
  console.log('grpc server running on at 0.0.0.0:' + port.toString());
 }

function printUsage () {;
  console.log("USAGE: ts-node src/server.ts shard port");
  console.log("shard: number in range(0, 15) or -1 for fullNode");
  console.log(" port: port to run the storage server on");
  process.exit(-1);
}

function callServer () {
  if (process.argv.length !== 4) {
    printUsage();
  }
  const shard : number = parseInt(process.argv[2]);
  const port : number = parseInt(process.argv[3]);
  console.log("Received shard and port: ", shard, port);
  if (shard !== -1 && (shard < 0 || shard > 15)) {
    printUsage();
  }
  runServer(shard, port);
}

callServer(); 