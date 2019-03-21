import * as StorageNodeService from '../build/proto/clientStorage_grpc_pb';
import {AccountReply, AccountRequest, BlockHashReply, BlockHashRequest, CodeReply, CodeRequest, MerklePatriciaTreeNode, RPCWitness, StorageReply, StorageRequest} from '../build/proto/clientStorage_pb';
import * as grpc from 'grpc';
import {rlpToEthereumAccount} from './utils';
import {RlpDecode, RlpList} from 'rlp-stream';

const runServer = (port: string) => {
  var client = new StorageNodeService.StorageNodeClient('localhost:50051',
                                       grpc.credentials.createInsecure());
  var request = new CodeRequest();
  const addr = Buffer.from("000d836201318ec6899a67540690382780743280", 'hex');
  request.setAddress(addr);
  request.setCodeOnly(false);
  console.log("REACHED");
  client.getCodeInfo(request, function(err, response) {
  	const accountInfo = response.getAccountInfo();
  	const rlpaccount = accountInfo!.getWitness()!.getValue();
//   	const account = rlpToEthereumAccount(RlpDecode(rlpaccount as Buffer) as RlpList);
  	console.log("Received codeinfo: ", rlpaccount);
  });
};

const printUsage = () => {
	console.log("Usage");
}

const callServer = () => {
  if (process.argv.length !== 3) {
    printUsage();
  }
  const port = process.argv[2];
  console.log('Started client: ');
  runServer(port);
};

callServer();