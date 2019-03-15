const grpc = require('grpc');
const protoLoader = require('@grpc/proto-loader');
const snode = require('../build/src/index');
const path = require('path');

const protoFileName = __dirname + '/../proto/client-storage.proto';
const protoLoaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
};

console.log(path.resolve('.'), path.resolve(__dirname));

const packageDefinition =
  protoLoader.loadSync(protoFileName, protoLoaderOptions);
const proto = grpc.loadPackageDefinition(packageDefinition);
const storageNode = new snode.StorageNode(-1, __dirname + "/test_data/genesis.json", __dirname + "/test_data/genesis.bin");

const server = new grpc.Server();
console.log("Started");
function returnHi(hirequest) {
  let hiresponse = {
  greeting: "Hi from server"
  };
  console.log(hirequest.greeting);
  return hiresponse;
}

function sayHi(call, callback) {
  callback(null, returnHi(call.request));
}

function GetCodeInfo(call) {
  console.log("Calling getCode");
  console.log("Request is", call);
  let resp;
  try {
    const address = Buffer.from(call.request.address.toString(),'hex');
    resp = storageNode.getCode(address, call.request.codeOnly);
  } catch (e) {
    console.log("Error in codereply", e);
    return e;
  }
  console.log("finished getCode call in server");
  var existence = (resp.account.value === null ? false : true);
  const proofreply = {
    encoding: resp.account.proof
  };
  const witnessreply = {
    value: resp.account.value,
    proof: proofreply
  };
  const accreply = {
    exists: existence,
    witness: witnessreply
  };
  const codereply = {
    accountInfo: accreply,
    code: resp.code
  };
  console.log("CodeReply is: ", codereply);
  return codereply;
}

function GetAccount(call) {
  console.log("Received GetAccount call from client");
  let resp;
  try {
    resp = storageNode.get(call.request.address);
  }
  catch (e) {
    console.log("Error in getaccount", e);
    return e;
  }
  var existence = (resp.value === null ? false : true);
  const proofreply = {
    encoding: resp.proof
  };
  const witnessreply = {
    value: resp.value,
    proof: proofreply
  };
  const accreply = {
    exists: existence,
    witness: witnessreply
  };
  console.log("getAccount successful in server. Sending to client:", accreply);
  return accreply;
}

function GetStorage(call) {
  console.log("Got GetStorage from client");
  let resp;
  try {
    resp = storageNode.getStorage(call.request.address, call.request.key);
  }
  catch (e) {
    console.log("Error in getstorage", e);
    return e;
  }
  const proofreply = {
    encoding: resp.proof
  };
  const witnessreply = {
    value: resp.value,
    proof: proofreply
  };
  const storagereply = {
    witness: witnessreply
  };
  console.log("getStorage successful in server. Sending to client:", storagereply)
  return storagereply;
}

function GetBlockHash(call) {
  console.log("GetBlockHash request from client");
  let resp;
  try {
    resp = storageNode.getBlockHash(call.request.number);
  }
  catch (e) {
    console.log("Error in getblockhash", e);
    return e;
  }
  const blockhashreply = {
    hashes: resp
  };
  console.log("getBlockHash successful in server. Sending to client:", blockhashreply)
  return blockhashreply;
}

server.addService(proto.storageapi.StorageNode.service, {
  getBlockHash: GetBlockHash,
  getStorage: GetStorage,
  getAccount: GetAccount,
  getCodeInfo: GetCodeInfo,
});

// Start the server
server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure());
server.start();
console.log('grpc server running on port:', '0.0.0.0:50051');