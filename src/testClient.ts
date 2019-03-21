import * as grpc from 'grpc';
import {RlpDecode, RlpList} from 'rlp-stream/build/src/rlp-stream';

import * as StorageNodeService from '../build/proto/clientStorage_grpc_pb';
import {AccountReply, AccountRequest, BlockHashReply, BlockHashRequest, CodeReply, CodeRequest, MerklePatriciaTreeNode, RPCWitness, StorageReply, StorageRequest} from '../build/proto/clientStorage_pb';

import {EthereumAccount, rlpToEthereumAccount} from './utils';

const assertEquals = (n0: bigint, n1: bigint) => {
  if (n0 !== n1) {
    throw new Error(
        'AssertionError!' +
        '\nReceived: ' + n0.toString() + '\nExpected: ' + n1.toString());
  }
};

const testGetCodeInfo = (client: StorageNodeService.StorageNodeClient) => {
  const request = new CodeRequest();
  const addr = Buffer.from('000d836201318ec6899a67540690382780743280', 'hex');
  const correctAccount: EthereumAccount = {
    balance: 200000000000000000000n,
    nonce: 0n,
    storageRoot:
        39309028074332508661983559455579427211983204215636056653337583610388178777121n,
    codeHash:
        89477152217924674838424037953991966239322087453347756267410168184682657981552n,
  };
  request.setAddress(addr);
  request.setCodeOnly(false);
  client.getCodeInfo(request, (err, response) => {
    if (err) {
      console.log('ERROR: getCodeInfo\n', err);
      return;
    }
    const accountInfo = response.getAccountInfo();
    const rlpaccount = Buffer.from(accountInfo!.getWitness()!.getValue_asU8());
    const account = rlpToEthereumAccount(RlpDecode(rlpaccount) as RlpList);

    assertEquals(account.balance, correctAccount.balance);
    assertEquals(account.nonce, correctAccount.nonce);
    assertEquals(account.codeHash, correctAccount.codeHash);
    assertEquals(account.storageRoot, correctAccount.storageRoot);
    console.log('Received CodeInfo:\n', account);
  });
};

const runTestClient = (port: string) => {
  const client = new StorageNodeService.StorageNodeClient(
      'localhost:' + port, grpc.credentials.createInsecure());

  testGetCodeInfo(client);
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