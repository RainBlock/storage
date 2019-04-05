import {decodeBlock, EthereumBlock} from '@rainblock/ethereum-block';
import {BatchPut, BranchNode, CachedMerklePatriciaTree, MerklePatriciaTree, MerklePatriciaTreeNode, MerklePatriciaTreeOptions, Witness} from '@rainblock/merkle-patricia-tree';
import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, hashAsBuffer, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import {RlpDecode, RlpEncode, RlpList} from 'rlp-stream';

import {computeBlockHash, EthereumAccount, ethereumAccountToRlp, gethAccountToEthAccount, GethStateDumpAccount, getStateFromGethJSON, rlpToEthereumAccount, UpdateOps} from './utils';

const nodeEthash = require('node-ethash');
const level = require('level-mem');
const ethjsBlock = require('ethereumjs-block');
const multiMap = require('multimap');

export interface Storage {
  isEmpty: () => boolean;
  get: (key: Buffer, root?: Buffer) => Promise<Witness<Buffer>>;
  getCode: (address: Buffer, codeOnly: boolean) => Promise<GetCodeReply>;
  getStorage: (address: Buffer, key: bigint) => Promise<Witness<Buffer>|null>;
  putGenesis: (genesisJSON?: string, genesisBIN?: string) => Promise<void>;
  update: (block: RlpList, putOps: UpdateOps[]) => Promise<void>;
  getRecentBlocks: () => Promise<Array<bigint>>;
}

export interface GetCodeReply {
  code: Buffer|undefined;
  account: Witness<Buffer>|undefined;
}

export class StorageNode implements Storage {
  /**
   * Determines the the StorageNode's partition
   */
  _shard: number;

  /**
   * _blockchain maps blockHash to the [Block, stateSnapshot]
   */
  _blockchain = new multiMap();

  /**
   * _blockNumberToHash maps blockNumber to blockHash
   */
  _blockNumberToHash = new multiMap();

  /**
   * _activeSnapshots maps blockNumber to the stateSnapshot
   */
  _activeSnapshots = new multiMap();

  _gcThreshold = 256n;

  _logFile: fs.WriteStream;

  _lowestBlockNumber = -1n;

  _highestBlockNumber = -1n;

  _InternalStorage = new Map<bigint, MerklePatriciaTree>();

  _CodeStorage = new Map<bigint, Buffer>();

  EMPTY_CODE_HASH = hashAsBigInt(HashType.KECCAK256, Buffer.from(''));

  constructor(shard?: number, genesisJSON?: string, genesisBIN?: string) {
    const date = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    const filename = ('./logs/' + date + '.log').split(' ').join('');
    this._logFile = fs.createWriteStream(filename, {flags: 'a'});

    this._shard = (shard && shard >= 0 && shard < 16) ? shard : -1;
    this.putGenesis(genesisJSON, genesisBIN);
  }

  verifyPOW(block: RlpList) {
    const _cacheDB = new level();
    const _ethash = new nodeEthash(_cacheDB);
    const ethBlock = new ethjsBlock(block);
    const blockNumber = ethBlock.header.number.toString('hex') + '\n#\n';
    _ethash.verifyPOW(ethBlock, (result: boolean) => {
      this._logFile.write(
          result ? 'Valid ' + blockNumber : 'Invalid ' + blockNumber);
    });
  }

  isEmpty(): boolean {
    if (this._blockchain.size !== 0 || this._blockNumberToHash.size !== 0 ||
        this._activeSnapshots.size !== 0) {
      return false;
    }
    return true;
  }

  private _updateGethStorage(
      storage: GethStateDumpAccount['storage'], root: string, codeHash: string,
      code: string) {
    const storageEntries = Object.entries(storage);
    const internalTrie = new MerklePatriciaTree({putCanDelete: false});
    if (storageEntries.length > 0) {
      for (const [key, value] of storageEntries) {
        const k = hashAsBuffer(HashType.KECCAK256, Buffer.from(key, 'hex'));
        const v = Buffer.from(value, 'hex');
        internalTrie.put(k, v);
      }
    }
    this._InternalStorage.set(BigInt(`0x${root}`), internalTrie);
    const codeBuffer = Buffer.from(code, 'hex');
    const codeHashBuffer = Buffer.from(codeHash, 'hex');
    this._CodeStorage.set(toBigIntBE(codeHashBuffer), codeBuffer);
  }

  private _updateStorageTrie(
      puts: Array<BatchPut<Buffer, Buffer>>, dels: Buffer[],
      internalTrie: MerklePatriciaTree): bigint {
    const newTrie = internalTrie.batchCOW(puts, dels);
    const root = toBigIntBE(newTrie.root);
    this._InternalStorage.set(root, newTrie);
    return root;
  }

  async putGenesis(genesisJSON?: string, genesisBIN?: string) {
    if (!this.isEmpty()) {
      throw new Error('Invalid: putGenesis when blockchain not empty');
    }
    const putOps = getStateFromGethJSON(
        ((!genesisJSON) ? __dirname + '/test_data/genesis.json' :
                          __dirname + '/' + genesisJSON));

    const trie = new MerklePatriciaTree({
      keyConverter: k => hashAsBuffer(HashType.KECCAK256, k),
      putCanDelete: false
    });
    const batchOps = [];
    for (const put of putOps) {
      if (this.belongsInShard(put.key)) {
        const val = gethAccountToEthAccount(put.val);
        batchOps.push({key: put.key, val: ethereumAccountToRlp(val)});
      }
    }
    trie.batch(batchOps, []);
    for (const put of putOps) {
      this._updateGethStorage(
          put.val.storage, put.val.root, put.val.codeHash, put.val.code);
    }

    const data = fs.readFileSync(
        ((!genesisBIN) ? __dirname + '/test_data/genesis.bin' :
                         __dirname + '/' + genesisBIN));
    const rlpGenesis = RlpDecode(data) as RlpList;
    const prom = decodeBlock(rlpGenesis);
    prom.then((genesis) => {
      const blockNum = genesis.header.blockNumber;
      const blockHash = computeBlockHash(rlpGenesis);
      this._blockchain.set(blockHash, [genesis, trie]);
      this._blockNumberToHash.set(blockNum, blockHash);
      this._activeSnapshots.set(blockNum, trie);
      this._lowestBlockNumber = blockNum;
      this._highestBlockNumber = blockNum;
    });
  }

  private async gc() {
    if (this._highestBlockNumber - this._lowestBlockNumber <
        this._gcThreshold) {
      return;
    }
    const diff = this._highestBlockNumber - this._lowestBlockNumber;
    const gcNumber = diff - this._gcThreshold;
    for (let i = BigInt(0); i < gcNumber; i += BigInt(1)) {
      const num = this._lowestBlockNumber + i;
      const hash = this._blockNumberToHash.get(num);
      const v1 = this._blockNumberToHash.delete(num);
      let v2 = true;
      for (const h of hash) {
        v2 = v2 && this._blockchain.delete(h);
      }
      const v3 = this._activeSnapshots.delete(num);
      if (!(v1 && v2 && v3)) {
        throw new Error('Panic while garbage collecting!');
      }
      this._lowestBlockNumber += 1n;
    }
  }

  private async persist(block: RlpList, putOps: UpdateOps[]) {
    this._logFile.write(RlpEncode(block));
    this._logFile.write('\n#\n');
    for (const put of putOps) {
      // this._logFile.write(put.type + ': ');
      // if (put.type === 'CreationOp') {
      //   let op = '';
      //   op += put.account.toString('hex') + ' ';
      //   op += put.value.toString(16) + ' ';
      //   for (const [key, value] of put.storage.entries()) {
      //     op += '[' + key.toString(16) + ', ' + value.toString(16) + '] ';
      //   }
      //   this._logFile.write(op);

      // } else if (put.type === 'DeletionOp') {
      //   const op = put.account.toString('hex');
      //   this._logFile.write(op);

      // } else if (put.type === 'ExecutionOp') {
      //   let op = '';
      //   op += put.account.toString('hex') + ' ';
      //   op += put.value.toString(16) + ' ';
      //   for (const sop of put.storageUpdates) {
      //     if (sop.type === 'StorageInsertion') {
      //       op +=
      //           '[' + sop.key.toString(16) + ', ' + sop.val.toString(16) + ']
      //           ';
      //     } else if (sop.type === 'StorageDeletion') {
      //       op += '[' + sop.key.toString(16) + '] ';
      //     }
      //   }
      //   this._logFile.write(op);

      // } else if (put.type === 'ValueChangeOp') {
      //   let op = '';
      //   op += put.account.toString('hex') + ' ';
      //   op += put.value.toString(16) + ' ';
      //   op += put.changes.toString(16);
      //   this._logFile.write(op);
      // }
      // this._logFile.write('\n#\n');
    }
  }

  private belongsInShard(account: Buffer): boolean {
    if ((this._shard === -1) || (Math.floor(account[0] / 16) === this._shard)) {
      return true;
    }
    return false;
  }

  async update(
      rlpBlock: RlpList, updateOps: UpdateOps[], merkleNodes?: Buffer) {
    this.gc();
    const block: EthereumBlock = await decodeBlock(rlpBlock);
    this.verifyPOW(rlpBlock);
    const parentHash = block.header.parentHash;
    const parentState: MerklePatriciaTree =
        (this._blockchain.get(parentHash)[0])![1];
    if (!parentState) {
      throw new Error('Cannot find parent state');
    }

    const delOps: Buffer[] = [], putOps: Array<BatchPut<Buffer, Buffer>> = [];

    for (const put of updateOps) {
      if (!this.belongsInShard(put.account)) {
        continue;
      }

      // First handle deletion
      if (put.deleted === true) {
        delOps.push(put.account);
      } else {
        const oldValue = parentState.get(put.account).value;
        if (oldValue === null) {
          // Create new account and insert into batchOps
          let codeHash;
          if (put.code) {
            codeHash = hashAsBigInt(HashType.KECCAK256, put.code);
            this._CodeStorage.set(codeHash, put.code);
          } else {
            codeHash = this.EMPTY_CODE_HASH;
          }
          const internalTrie = new MerklePatriciaTree({putCanDelete: false});
          const sPuts: Array<BatchPut<Buffer, Buffer>> = [];
          const sDels: Buffer[] = [];
          for (const sput of put.storage) {
            if (sput.value === BigInt(0)) {
              continue;
            }
            sPuts.push({
              key: hashAsBuffer(HashType.KECCAK256, toBufferBE(sput.key, 20)),
              val: toBufferBE(sput.value, 20)
            });
          }
          const storageRoot = this._updateStorageTrie(sPuts, [], internalTrie);
          const newAccount: EthereumAccount =
              {balance: put.balance, nonce: put.updates, storageRoot, codeHash};
          putOps.push(
              {key: put.account, val: ethereumAccountToRlp(newAccount)});
        } else {
          // Update account and insert into batchOps
          const oldAccount =
              rlpToEthereumAccount(RlpDecode(oldValue) as RlpList);
          if (put.balance) {
            oldAccount.balance = put.balance;
          }
          if (put.updates) {
            oldAccount.nonce += put.updates;
          }
          if (put.code) {
            const codeHash = hashAsBigInt(HashType.KECCAK256, put.code);
            this._CodeStorage.set(codeHash, put.code);
            oldAccount.codeHash = codeHash;
          }
          if (put.storage.length !== 0) {
            const oldStorageRoot = oldAccount.storageRoot;
            const internalTrie = this._InternalStorage.get(oldStorageRoot);
            if (!internalTrie) {
              throw new Error('Can\'t find storage for account');
            }
            const sPuts: Array<BatchPut<Buffer, Buffer>> = [],
                                                sDels: Buffer[] = [];
            for (const sop of put.storage) {
              if (sop.value === BigInt(0)) {
                sDels.push(
                    hashAsBuffer(HashType.KECCAK256, toBufferBE(sop.key, 20)));
              } else {
                sPuts.push({
                  key:
                      hashAsBuffer(HashType.KECCAK256, toBufferBE(sop.key, 20)),
                  val: toBufferBE(sop.value, 20)
                });
              }
            }
            const newStorageRoot =
                this._updateStorageTrie(sPuts, sDels, internalTrie!);
            oldAccount.storageRoot = newStorageRoot;
          }
          putOps.push(
              {key: put.account, val: ethereumAccountToRlp(oldAccount)});
        }
      }
    }
    const trie = parentState.batchCOW(putOps, delOps);
    const root = trie.root;
    if (merkleNodes && merkleNodes.length === 1) {
      this._checkRoots(root, block.header.stateRoot, merkleNodes);
    }
    const blockNum = block.header.blockNumber;
    const blockHash = computeBlockHash(rlpBlock);
    this._blockchain.set(blockHash, [block, trie]);
    this._blockNumberToHash.set(blockNum, blockHash);
    this._activeSnapshots.set(blockNum, trie);
    this.persist(rlpBlock, updateOps);
    this._highestBlockNumber = (this._highestBlockNumber > blockNum) ?
        this._highestBlockNumber :
        blockNum;
  }

  private async _checkRoots(shRoot: Buffer, bRoot: bigint, rlp: Buffer) {
    const cache = new CachedMerklePatriciaTree<Buffer, Buffer>();
    const rootNode: MerklePatriciaTreeNode<Buffer> =
        cache.rlpToMerkleNode(rlp, (val: Buffer) => (val));

    const merkleHashes: Buffer[] = [];
    let branchIdx = 0;
    if (rootNode instanceof BranchNode) {
      for (const branch of rootNode.branches) {
        if (!branch) {
          branchIdx += 1;
          continue;
        }
        merkleHashes[branchIdx] = toBufferBE(
            branch.hash({} as MerklePatriciaTreeOptions<{}, Buffer>), 32);
        branchIdx += 1;
      }
    }
    const valHash = (rootNode.value === null) ?
        Buffer.from([]) :
        hashAsBuffer(HashType.KECCAK256, rootNode.value);
    merkleHashes.push(valHash);
    merkleHashes[this._shard] = shRoot;

    const rHash = hashAsBigInt(HashType.KECCAK256, RlpEncode(merkleHashes));
    if (rHash !== bRoot) {
      throw new Error(
          'sharded stateRoots don\'t has to block\'s global stateRoot');
    }
  }

  async getRecentBlocks(): Promise<Array<bigint>> {
    const retVal = [];
    const blockHashIterator = this._blockchain.keys();
    for (const hash of blockHashIterator) {
      retVal.push(hash);
    }
    return retVal;
  }

  async getBlockHash(blockNum: bigint): Promise<Array<bigint>> {
    if (blockNum === BigInt(-1)) {
      const prom = this.getRecentBlocks();
      return prom;
    }
    const retVal = this._blockNumberToHash.get(blockNum);
    return (retVal) ? retVal : [];
  }

  async get(address: Buffer): Promise<Witness<Buffer>> {
    const stateList: MerklePatriciaTree[]|MerklePatriciaTree =
        this._activeSnapshots.get(this._highestBlockNumber);
    if (stateList instanceof Array) {
      const s = stateList[0];
      return s.get(address);
    } else {
      return stateList.get(address);
    }
  }

  async getStorage(address: Buffer, key: bigint):
      Promise<Witness<Buffer>|null> {
    const currentSnapshot: MerklePatriciaTree[]|MerklePatriciaTree =
        this._activeSnapshots.get(this._highestBlockNumber);
    let state;
    if (currentSnapshot instanceof Array) {
      state = currentSnapshot[0];
      if (!state) {
        throw new Error(
            'getStorage: No states for block ' +
            this._highestBlockNumber.toString());
      }
    } else {
      state = currentSnapshot;
    }
    const rlpwitness = state.get(address);
    const rlpaccount = rlpwitness.value;
    if (!rlpaccount) {
      return null;
    }
    const account = rlpToEthereumAccount(RlpDecode(rlpaccount!) as RlpList);
    const storageRoot = account.storageRoot;
    const storageTrie = this._InternalStorage.get(storageRoot);
    if (!storageTrie) {
      throw new Error('No internalStorageTrie with storageRoot');
    }
    const convKey = hashAsBuffer(HashType.KECCAK256, toBufferBE(key, 20));
    const ret = storageTrie.get(convKey);
    return ret;
  }

  async getCode(address: Buffer, codeOnly: boolean): Promise<GetCodeReply> {
    const currentSnapshot: MerklePatriciaTree =
        this._activeSnapshots.get(this._highestBlockNumber);
    let state;
    if (currentSnapshot instanceof Array) {
      state = currentSnapshot[0];
      if (!state) {
        throw new Error(
            'getCode: no states for block' +
            this._highestBlockNumber.toString());
      }
    } else {
      state = currentSnapshot;
    }
    const witness = state.get(address);
    const rlpaccount = witness.value;
    if (!rlpaccount) {
      if (codeOnly) {
        return {code: undefined, account: undefined};
      }
      return {code: undefined, account: witness};
    }
    const account = rlpToEthereumAccount(RlpDecode(rlpaccount) as RlpList);
    const codeHash = account.codeHash;
    const code = this._CodeStorage.get(codeHash);
    if (codeOnly) {
      return {code, account: undefined};
    }
    return {code, account: witness};
  }
}
