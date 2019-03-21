import * as grpc from 'grpc';
import * as StorageNodeService from '../build/proto/clientStorage_grpc_pb';

import {AccountReply, AccountRequest, BlockHashReply, BlockHashRequest, CodeReply, CodeRequest, MerklePatriciaTreeNode, RPCWitness, StorageReply, StorageRequest} from '../build/proto/clientStorage_pb';

const runTestClient = (port: string) => {
  const client = new StorageNodeService.StorageNodeClient(
      'localhost:50051', grpc.credentials.createInsecure());
  const request = new CodeRequest();
  const addr = Buffer.from('000d836201318ec6899a67540690382780743280', 'hex');
  request.setAddress(addr);
  request.setCodeOnly(false);
  console.log('REACHED');
  client.getCodeInfo(request, (err, response) => {
    const accountInfo = response.getAccountInfo();
    const rlpaccount = accountInfo!.getWitness()!.getValue();
    console.log('Received codeinfo: ', rlpaccount);
  });
};

const printUsage = () => {
  console.log('USAGE: node -r ts-node/register src/testClient.ts port');
  process.exit(-1);
};

const callClient = () => {
  if (process.argv.length !== 3) {
    printUsage();
  }
  const port = process.argv[2];
  console.log('Starting client on port', port);
  runTestClient(port);
};

callClient();