import { StorageNodeService } from "../proto/client-storage_grpc_pb";
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
} from "../proto/client-storage_pb";
import { ServerUnaryCall, sendUnaryData } from "grpc";
import * as grpc from "grpc";

const snode = require('../build/src/index');
const storageNode = new snode.StorageNode(-1, "../../src/test_data/genesis.json", "../../src/test_data/genesis.bin");

const GetCodeInfo = (
 call: ServerUnaryCall<CodeRequest>,
 callback: sendUnaryData<CodeReply>
) => {
  console.log("Calling getCode");
  console.log("Request is", call);
  let resp;
  try {
    const address = Buffer.from(call.request.getAddress().toString(),'hex');
    resp = storageNode.getCode(address, call.request.getCodeOnly());
  } catch (e) {
    console.log("Error in codereply", e);
    return e;
  }
  console.log("finished getCode call in server");
  var existence = (resp.account.value === null ? false : true);

  let idx;
  let mptnodes = new Array();
  for (idx = 0; idx< resp.account.proof.length; idx++) {
    mptnodes[idx] = new MerklePatriciaTreeNode();
    mptnodes[idx].setEncoding(resp.account.proof[idx]);
  }
  
  const rpcwitness = new RPCWitness();
  rpcwitness.setValue(resp.account.value);
  rpcwitness.setProofList(mptnodes);

  const accountreply = new AccountReply();
  accountreply.setExists(existence);
  accountreply.setWitness(rpcwitness);

  const codereply = new CodeReply();
  codereply.setAccountInfo(accountreply);
  codereply.setCode(resp.code);
  
  console.log("CodeReply is: ", codereply);
  callback(null, codereply);
};

const GetAccount = (
 call: ServerUnaryCall<AccountRequest>,
 callback: sendUnaryData<AccountReply>
) => {
  console.log("Calling getAccount");
  console.log("Request is", call);
  let resp;
  try {
    resp = storageNode.get(call.request.getAddress());
  }
  catch (e) {
    console.log("Error in getAccount", e);
    return e;
  }
  console.log("finished getAccount call in server");
  var existence = (resp.account.value === null ? false : true);

  let idx;
  let mptnodes = new Array();
  for (idx = 0; idx< resp.account.proof.length; idx++) {
    mptnodes[idx] = new MerklePatriciaTreeNode();
    mptnodes[idx].setEncoding(resp.account.proof[idx]);
  }
  
  const rpcwitness = new RPCWitness();
  rpcwitness.setValue(resp.account.value);
  rpcwitness.setProofList(mptnodes);

  const accountreply = new AccountReply();
  accountreply.setExists(existence);
  accountreply.setWitness(rpcwitness);
  
  console.log("AccountReply is: ", accountreply);
  callback(null, accountreply);
}; 

const GetStorage = (
 call: ServerUnaryCall<StorageRequest>,
 callback: sendUnaryData<StorageReply>
) => {
  console.log("Calling getStorage");
  console.log("Request is", call);
  let resp;
  try {
    resp = storageNode.getStorage(call.request.getAddress(), call.request.getKey());
  }
  catch (e) {
    console.log("Error in getstorage", e);
    return e;
  }
  console.log("finished getStorage call in server");
  var existence = (resp.account.value === null ? false : true);

  let idx;
  let mptnodes = new Array();
  for (idx = 0; idx< resp.account.proof.length; idx++) {
    mptnodes[idx] = new MerklePatriciaTreeNode();
    mptnodes[idx].setEncoding(resp.account.proof[idx]);
  }

  const rpcwitness = new RPCWitness();
  rpcwitness.setValue(resp.account.value);
  rpcwitness.setProofList(mptnodes);

  const storagereply = new StorageReply();
  storagereply.setWitness(rpcwitness);
  
  console.log("StorageReply is: ", storagereply);
  callback(null, storagereply);
};

const GetBlockHash = (
 call: ServerUnaryCall<BlockHashRequest>,
 callback: sendUnaryData<BlockHashReply>
) => {
  console.log("Calling getBlockHash");
  console.log("Request is", call);
  let resp;
  try {
    resp = storageNode.getBlockHash(call.request.getNumber());
  }
  catch (e) {
    console.log("Error in getblockhash", e);
    return e;
  }
  console.log("finished getBlockHash call in server");
  const blockhashreply = new BlockHashReply();
  blockhashreply.setHashesList(resp);

  console.log("BlockHashReply is: ", blockhashreply);
  callback(null, blockhashreply);
};


function main() {
 const server = new grpc.Server();
 server.addService(StorageNodeService, { getCodeInfo: GetCodeInfo, getAccount: GetAccount, getStorage: GetStorage, getBlockHash: GetBlockHash });
 server.bind("0.0.0.0:50051", grpc.ServerCredentials.createInsecure());
 server.start();
 console.log('grpc server running on at 0.0.0.0:50051');
}
 
main();
