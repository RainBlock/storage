import {toBigIntBE} from 'bigint-buffer';
import { StorageNodeService } from "../proto/client-storage_grpc_pb";
import { StorageNode} from "./index";
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

const storageNode = new StorageNode(-1, "../../src/test_data/genesis.json", "../../src/test_data/genesis.bin");

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

  // If code is undefined, it means that the account is non-existent
  var existence = (resp.code === undefined ? false : true);

  let rpcwitness = new RPCWitness();

  // if codeOnly is true, then account will always be undefined
  if(!call.request.getCodeOnly()) {
    let idx;
    let mptnodes = new Array();
    for (idx = 0; idx< resp.account!.proof.length; idx++) {
      mptnodes[idx] = new MerklePatriciaTreeNode();
      mptnodes[idx].setEncoding(resp.account!.proof[idx]);
    }
    const val = resp.account!.value === null ? "" : resp.account!.value;
    rpcwitness.setValue(val);
    rpcwitness.setProofList(mptnodes);

  } else {
    // let mptnodes = new Array();
    // mptnodes[0].setEncoding(null);
    rpcwitness.setValue("");
    rpcwitness.setProofList([]);
  }

  const accountreply = new AccountReply();
  accountreply.setExists(existence);
  accountreply.setWitness(rpcwitness);

  const codereply = new CodeReply();
  codereply.setAccountInfo(accountreply);

  const code = resp.code === undefined? "":resp.code;
  codereply.setCode(code);
  
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
    const address = Buffer.from(call.request.getAddress().toString(),'hex');
    resp = storageNode.get(address);
  }
  catch (e) {
    console.log("Error in getAccount", e);
    return e;
  }
  console.log("finished getAccount call in server");
  var existence = (resp.value === null ? false : true);

  let idx;
  let mptnodes = new Array();
  for (idx = 0; idx< resp.proof.length; idx++) {
    mptnodes[idx] = new MerklePatriciaTreeNode();
    mptnodes[idx].setEncoding(resp.proof[idx]);
  }
  
  const rpcwitness = new RPCWitness();
  const val = resp.value === null ? "" : resp.value;
  rpcwitness.setValue(val);
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
    const address = Buffer.from(call.request.getAddress().toString(),'hex');
    let key;
    // if(call.request.getKey() instanceof String) {
      key = BigInt(call.request.getKey());
      console.log("String getStorageKey = ", call.request.getKey());
    // } else {
    //   key = toBigIntBE(call.request.getKey());
    //   console.log("Array getStorageKey = ", call.request.getKey());
    // }

    resp = storageNode.getStorage(address, key);
  }
  catch (e) {
    console.log("Error in getstorage", e);
    return e;
  }
  console.log("finished getStorage call in server");
  var existence = (resp === null ? false : true);

  let rpcwitness = new RPCWitness();
  let storagereply = new StorageReply();

  // ASH: if resp is not null, value will also most definitely not be null
  if (resp) {
    let idx;
    let mptnodes = new Array();
    for (idx = 0; idx< resp.proof.length; idx++) {
      mptnodes[idx] = new MerklePatriciaTreeNode();
      mptnodes[idx].setEncoding(resp.proof[idx]);
    }

    rpcwitness.setValue(resp.value!);
    rpcwitness.setProofList(mptnodes);

    storagereply.setWitness(rpcwitness);
  } else {
    rpcwitness.setValue("");
    rpcwitness.setProofList([]);
    storagereply.setWitness(rpcwitness);
  }

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
    resp = storageNode.getBlockHash(BigInt(call.request.getNumber()));
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
