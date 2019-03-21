/*import * as protoLoader from '@grpc/proto-loader';
import * as snode from './index';
const grpc = require('grpc');

const protoFileName: string = __dirname + '/../../proto/verif-store.proto';
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

const server = new grpc.Server();
const storageNode = new snode.StorageNode(
    -1, '../../src/test_data/genesis.json', '../../src/test_data/genesis.bin');

export interface GetInputMsg {
  key: Buffer;
  root: Buffer;
}

// Callable methods corresponding to the methods in .proto
server.addService(proto.storageNode.verifierToStorage.service, {

  get(input: GetInputMsg) {
    const ret = storageNode.get(input.key);
    return ret;
  },

  getRecentBlocks() {
    const hashes = storageNode.getRecentBlocks();
    return {blockHashes: hashes};
  }

});

// Start the server
server.bind('0.0.0.0:50050', grpc.ServerCredentials.createInsecure());
server.start();
console.log('grpc server running on port:', '0.0.0.0:50050');*/