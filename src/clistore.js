const grpc = require('grpc');
const protoLoader = require('@grpc/proto-loader');
const snode = require('../build/src/index');

const protoFileName = __dirname + '/../proto/client-storage.proto';
const protoLoaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
};

const packageDefinition =
    protoLoader.loadSync(protoFileName, protoLoaderOptions);
const proto = grpc.loadPackageDefinition(packageDefinition);
const storageNode = snode.storageNode;

const server = new grpc.Server();

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

function getCodeInfo(call) {
    let resp = storageNode.getCode(call.request.address, call.request.codeOnly);
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
    return codereply;
}

function getAccount(call) {
    let resp = storageNode.get(call.request.address);
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
    return accreply;
}

function getStorage(call) {
    let resp = storageNode.getStorage(call.request.address, call.request.key);

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
    return storagereply;
}

function getBlockHash(call) {
    let resp = storageNode.getBlockHash(call.request.number);
    const blockhashreply = {
        hashes: resp
    };
    return blockhashreply;
}

// Start the server
server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure());
server.start();
console.log('grpc server running on port:', '0.0.0.0:50051');