import {decodeBlock, EthereumBlock} from '@rainblock/ethereum-block';
import {BatchPut, BranchNode, CachedMerklePatriciaTree, MerklePatriciaTree, MerklePatriciaTreeNode, MerklePatriciaTreeOptions, Witness} from '@rainblock/merkle-patricia-tree';
import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, hashAsBuffer, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import {RlpDecode, RlpEncode, RlpList} from 'rlp-stream';

import {computeBlockHash, EthereumAccount, ethereumAccountToRlp, gethAccountToEthAccount, GethStateDumpAccount, getStateFromGethJSON, rlpToEthereumAccount, UpdateOps} from './utils';

const multiMap = require('multimap');

export interface Storage {
  isEmpty: () => boolean;
  get: (key: Buffer, root?: Buffer) => Promise<Witness<Buffer>>;
  getCode: (address: Buffer, codeOnly: boolean) => Promise<GetCodeReply>;
  getStorage: (address: Buffer, key: bigint) => Promise<Witness<Buffer>|null>;
  putGenesis: (genesisJSON?: string, genesisBIN?: string) => void;
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

  _InternalStorage = new Map<bigint, MerklePatriciaTree<bigint, Buffer>>();

  _CodeStorage = new Map<bigint, Buffer>();

  EMPTY_CODE_HASH = hashAsBigInt(HashType.KECCAK256, Buffer.from(''));

  constructor(shard?: number, genesisJSON?: string, genesisBIN?: string) {
    const date = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    const filename = ('./logs/' + date + '.log').split(' ').join('');
    this._logFile = fs.createWriteStream(filename, {flags: 'a'});

    this._shard =
        (shard !== undefined && shard !== null && shard >= 0 && shard < 16) ?
        shard :
        -1;
    this.putGenesis(genesisJSON, genesisBIN);
  }

  /*
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
  */

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
    const internalTrie = new MerklePatriciaTree<bigint, Buffer>({
      keyConverter: k => hashAsBuffer(HashType.KECCAK256, toBufferBE(k, 20)),
      putCanDelete: false
    });
    if (storageEntries.length > 0) {
      for (const [key, value] of storageEntries) {
        const k = BigInt(`0x${key}`);
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
      puts: Array<BatchPut<bigint, Buffer>>, dels: Array<bigint>,
      internalTrie: MerklePatriciaTree<bigint, Buffer>): bigint {
    const newTrie = internalTrie.batchCOW(puts, dels);
    const root = toBigIntBE(newTrie.root);
    this._InternalStorage.set(root, newTrie);
    return root;
  }

  putGenesis(genesisJSON?: string, genesisBIN?: string) {
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
      const val = gethAccountToEthAccount(put.val);
      batchOps.push({key: put.key, val: ethereumAccountToRlp(val)});
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

  // TODO: logFile per shard?
  private async persist(
      block: RlpList, putOps: Array<BatchPut<Buffer, Buffer>>,
      delOps: Buffer[]) {
    this._logFile.write(RlpEncode(block));
    this._logFile.write('\n#\n');
    const puts: Buffer[] = [];
    for (const put of putOps) {
      puts.push(put.key);
      puts.push(put.val);
    }
    this._logFile.write(RlpEncode(puts));
    this._logFile.write(RlpEncode(delOps));
    this._logFile.write('\n#\n');
  }

  async update(
      rlpBlock: RlpList, updateOps: UpdateOps[], merkleNodes?: Buffer) {
    this.gc();
    const block: EthereumBlock = await decodeBlock(rlpBlock);
    const parentHash = block.header.parentHash;
    const parentState: MerklePatriciaTree =
        (this._blockchain.get(parentHash)[0])![1];
    if (!parentState) {
      throw new Error('Cannot find parent state');
    }

    const delOps: Buffer[] = [], putOps: Array<BatchPut<Buffer, Buffer>> = [];

    for (const put of updateOps) {
      if (put.deleted === true) {
        delOps.push(put.account);
      } else {
        const oldValue = parentState.get(put.account).value;
        if (oldValue === null) {
          let codeHash: bigint, storageRoot: bigint;
          if (put.code) {
            codeHash = hashAsBigInt(HashType.KECCAK256, put.code);
            this._CodeStorage.set(codeHash, put.code);
          } else {
            codeHash = this.EMPTY_CODE_HASH;
          }
          const internalTrie = new MerklePatriciaTree<bigint, Buffer>({
            keyConverter: k =>
                hashAsBuffer(HashType.KECCAK256, toBufferBE(k, 20)),
            putCanDelete: false
          });
          const sPuts: Array<BatchPut<bigint, Buffer>> = [];
          if (put.storage) {
            for (const sput of put.storage) {
              if (sput.value === BigInt(0)) {
                continue;
              }
              sPuts.push({key: sput.key, val: toBufferBE(sput.value, 20)});
            }
            storageRoot = this._updateStorageTrie(sPuts, [], internalTrie);
          } else {
            storageRoot = toBigIntBE(internalTrie.root);
          }
          const balance: bigint = (put.balance) ? put.balance : 0n;
          const nonce: bigint = (put.nonce) ? put.nonce : 0n;
          const newAccount:
              EthereumAccount = {balance, nonce, storageRoot, codeHash};
          putOps.push(
              {key: put.account, val: ethereumAccountToRlp(newAccount)});
        } else {
          const oldAccount =
              rlpToEthereumAccount(RlpDecode(oldValue) as RlpList);
          if (put.balance) {
            oldAccount.balance = put.balance;
          }
          if (put.nonce) {
            oldAccount.nonce = put.nonce;
          }
          if (put.code) {
            const codeHash = hashAsBigInt(HashType.KECCAK256, put.code);
            this._CodeStorage.set(codeHash, put.code);
            oldAccount.codeHash = codeHash;
          }
          if (put.storage && put.storage.length !== 0) {
            const oldStorageRoot = oldAccount.storageRoot;
            let internalTrie = this._InternalStorage.get(oldStorageRoot);
            if (!internalTrie) {
              internalTrie = new MerklePatriciaTree<bigint, Buffer>({
                keyConverter: k =>
                    hashAsBuffer(HashType.KECCAK256, toBufferBE(k, 20)),
                putCanDelete: false
              });
            }
            const sPuts: Array<BatchPut<bigint, Buffer>> = [];
            const sDels: Array<bigint> = [];
            for (const sop of put.storage) {
              if (sop.value === BigInt(0)) {
                sDels.push(sop.key);
              } else {
                sPuts.push({key: sop.key, val: toBufferBE(sop.value, 20)});
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
    if (merkleNodes && this._shard === -1) {
      const root = toBigIntBE(trie.root);
      const merkleRoot = hashAsBigInt(HashType.KECCAK256, merkleNodes);
      if (root !== block.header.stateRoot || merkleRoot !== root) {
        throw new Error('stateRoot and blockStateRoot dont match');
      }
    } else if (merkleNodes && trie.rootNode instanceof BranchNode) {
      const merkleRoot = hashAsBigInt(HashType.KECCAK256, merkleNodes);
      if (merkleRoot !== block.header.stateRoot) {
        throw new Error('stateRoot and blockStateRoot dont match');
      }
      const root = (trie.rootNode.branches[this._shard])!.hash(
          {} as MerklePatriciaTreeOptions<{}, Buffer>);
      this._checkRoots(root, merkleNodes);
    }

    const blockNum = block.header.blockNumber;
    const blockHash = computeBlockHash(rlpBlock);
    this._blockchain.set(blockHash, [block, trie]);
    this._blockNumberToHash.set(blockNum, blockHash);
    this._activeSnapshots.set(blockNum, trie);
    this.persist(rlpBlock, putOps, delOps);
    this._highestBlockNumber = (this._highestBlockNumber > blockNum) ?
        this._highestBlockNumber :
        blockNum;
  }

  private async _checkRoots(shRoot: bigint, rlp: Buffer) {
    const cache = new CachedMerklePatriciaTree<Buffer, Buffer>();
    const rootNode: MerklePatriciaTreeNode<Buffer> =
        cache.rlpToMerkleNode(rlp, (val: Buffer) => (val));

    if (rootNode instanceof BranchNode) {
      const merkleBranch = rootNode.branches[this._shard];
      const branchHash =
          merkleBranch.hash({} as MerklePatriciaTreeOptions<{}, Buffer>);
      if (branchHash !== shRoot) {
        throw new Error('shardedStateRoots dont hash to blockStateRoot');
      }
    }
    console.log(this._shard, 'checkRoots passes');
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
    const ret = storageTrie.get(key);
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
