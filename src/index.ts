import {decodeBlock, EthereumBlock} from '@rainblock/ethereum-block';
import {BatchPut, MerklePatriciaTree, RlpWitness, verifyWitness, Witness} from '@rainblock/merkle-patricia-tree';
import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, hashAsBuffer, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import {RlpDecode, RlpEncode, RlpList} from 'rlp-stream';

import {computeBlockHash, EthereumAccount, ethereumAccountToRlp, gethAccountToEthAccount, GethStateDumpAccount, getStateFromGethJSON, rlpToEthereumAccount, UpdateOps} from './utils';

const nodeEthash = require('node-ethash');
const level = require('level-mem');
const ethjsBlock = require('ethereumjs-block');
const multiMap = require('multimap');

export interface Storage<K = Buffer, V = Buffer> {
  isEmpty: () => boolean;
  get: (key: Buffer, root?: Buffer) => RlpWitness;
  getCode: (address: Buffer, codeOnly: boolean) => {
    code: Buffer|undefined, account: RlpWitness|undefined
  };
  getStorage: (address: Buffer, key: bigint) => RlpWitness | null;
  putGenesis: (genesisJSON?: string, genesisBIN?: string) => void;
  update: (block: RlpList, putOps: UpdateOps) => void;
  prove: (root: Buffer, key: Buffer, witness: RlpWitness) => boolean;
  getRecentBlocks: () => Array<bigint>;
}

export class StorageNode<K = Buffer, V = Buffer> implements
    Storage<Buffer, Buffer> {
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
    const genesis = decodeBlock(rlpGenesis);

    const blockNum = genesis.header.blockNumber;
    const blockHash = computeBlockHash(rlpGenesis);
    this._blockchain.set(blockHash, [genesis, trie]);
    this._blockNumberToHash.set(blockNum, blockHash);
    this._activeSnapshots.set(blockNum, trie);
    this._lowestBlockNumber = blockNum;
    this._highestBlockNumber = blockNum;
  }

  private gc() {
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

  private persist(block: RlpList, putOps: UpdateOps) {
    this._logFile.write(RlpEncode(block));
    this._logFile.write('\n#\n');
    for (const put of putOps.ops) {
      this._logFile.write(put.type + ': ');
      if (put.type === 'CreationOp') {
        let op = '';
        op += put.account.toString('hex') + ' ';
        op += put.value.toString(16) + ' ';
        for (const [key, value] of put.storage.entries()) {
          op += '[' + key.toString(16) + ', ' + value.toString(16) + '] ';
        }
        this._logFile.write(op);

      } else if (put.type === 'DeletionOp') {
        const op = put.account.toString('hex');
        this._logFile.write(op);

      } else if (put.type === 'ExecutionOp') {
        let op = '';
        op += put.account.toString('hex') + ' ';
        op += put.value.toString(16) + ' ';
        for (const sop of put.storageUpdates) {
          if (sop.type === 'StorageInsertion') {
            op +=
                '[' + sop.key.toString(16) + ', ' + sop.val.toString(16) + '] ';
          } else if (sop.type === 'StorageDeletion') {
            op += '[' + sop.key.toString(16) + '] ';
          }
        }
        this._logFile.write(op);

      } else if (put.type === 'ValueChangeOp') {
        let op = '';
        op += put.account.toString('hex') + ' ';
        op += put.value.toString(16) + ' ';
        op += put.changes.toString(16);
        this._logFile.write(op);
      }
      this._logFile.write('\n#\n');
    }
  }

  private belongsInShard(account: Buffer): boolean {
    if ((this._shard === -1) || (Math.floor(account[0] / 16) === this._shard)) {
      return true;
    }
    return false;
  }

  update(rlpBlock: RlpList, putOps: UpdateOps, merkleHashes?: Buffer[]) {
    this.gc();
    const block: EthereumBlock = decodeBlock(rlpBlock);
    this.verifyPOW(rlpBlock);
    const parentHash = block.header.parentHash;
    const parentState: MerklePatriciaTree =
        (this._blockchain.get(parentHash)[0])![1];
    if (!parentState) {
      throw new Error('Cannot find parent state');
    }

    const delOps = [], updateOps: Array<BatchPut<Buffer, Buffer>> = [];
    for (const put of putOps.ops) {
      if (!this.belongsInShard(put.account)) {
        continue;
      }

      if (put.type === 'CreationOp') {
        let codeHash;
        if (put.code !== undefined) {
          codeHash = hashAsBigInt(HashType.KECCAK256, put.code);
          this._CodeStorage.set(codeHash, put.code);
        } else {
          codeHash = hashAsBigInt(HashType.KECCAK256, Buffer.from(''));
        }
        const internalTrie = new MerklePatriciaTree({putCanDelete: false});
        const puts: Array<BatchPut<Buffer, Buffer>> = [];
        put.storage.forEach((key, value, map) => {
          puts.push({
            key: hashAsBuffer(HashType.KECCAK256, toBufferBE(key, 20)),
            val: toBufferBE(key, 20)
          });
        });
        const storageRoot = this._updateStorageTrie(puts, [], internalTrie);
        const balance = put.value;
        const nonce = BigInt(0);
        const account:
            EthereumAccount = {balance, nonce, storageRoot, codeHash};
        updateOps.push({key: put.account, val: ethereumAccountToRlp(account)});

      } else if (put.type === 'DeletionOp') {
        delOps.push(put.account);

      } else if (put.type === 'ValueChangeOp') {
        const val = parentState.get(put.account).value;
        if (!val) {
          throw new Error('Attempt to update a non-existent value');
        }
        const account = rlpToEthereumAccount(RlpDecode(val!) as RlpList);
        account.nonce += BigInt(put.changes);
        account.balance = put.value;
        updateOps.push({key: put.account, val: ethereumAccountToRlp(account)});

      } else if (put.type === 'ExecutionOp') {
        const val = parentState.get(put.account).value;
        if (!val) {
          throw new Error('Attempt to update a non-existent value');
        }
        const account = rlpToEthereumAccount(RlpDecode(val!) as RlpList);
        account.balance = put.value;
        const storage = this._InternalStorage.get(account.storageRoot);
        const puts: Array<BatchPut<Buffer, Buffer>> = [], dels = [];
        for (const op of put.storageUpdates) {
          if (op.type === 'StorageInsertion') {
            puts.push({
              key: hashAsBuffer(HashType.KECCAK256, toBufferBE(op.key, 20)),
              val: toBufferBE(op.val, 20)
            });
          } else if (op.type === 'StorageDeletion') {
            dels.push(hashAsBuffer(HashType.KECCAK256, toBufferBE(op.key, 20)));
          }
        }
        const storageRoot = this._updateStorageTrie(puts, dels, storage!);
        account.storageRoot = storageRoot;
        updateOps.push({key: put.account, val: ethereumAccountToRlp(account)});
      }
    }

    const trie = parentState.batchCOW(updateOps, delOps);
    const root = trie.root;
    if (merkleHashes) {
      merkleHashes[this._shard] = root;
      const globalRoot =
          hashAsBigInt(HashType.KECCAK256, RlpEncode(merkleHashes));
      if (globalRoot !== block.header.stateRoot) {
        throw new Error(
            'sharded stateRoots don\'t has to block\'s global stateRoot');
      }
    }
    const blockNum = block.header.blockNumber;
    const blockHash = computeBlockHash(rlpBlock);
    this._blockchain.set(blockHash, [block, trie]);
    this._blockNumberToHash.set(blockNum, blockHash);
    this._activeSnapshots.set(blockNum, trie);
    this.persist(rlpBlock, putOps);
    this._highestBlockNumber = (this._highestBlockNumber > blockNum) ?
        this._highestBlockNumber :
        blockNum;
  }

  getRecentBlocks(): Array<bigint> {
    const retVal = [];
    const blockHashIterator = this._blockchain.keys();
    for (const hash of blockHashIterator) {
      retVal.push(hash);
    }
    return retVal;
  }

  getBlockHash(blockNum: bigint): Array<bigint> {
    if (blockNum === BigInt(-1)) {
      return this.getRecentBlocks();
    }
    const retVal = this._blockNumberToHash.get(blockNum);
    return (retVal) ? retVal : [];
  }

  get(address: Buffer): RlpWitness {
    const stateList: MerklePatriciaTree[]|MerklePatriciaTree =
        this._activeSnapshots.get(this._highestBlockNumber);
    if (stateList instanceof Array) {
      const s = stateList[0];
      return s.rlpSerializeWitness(s.get(address));
    } else {
      return stateList.rlpSerializeWitness(stateList.get(address));
    }
  }

  getStorage(address: Buffer, key: bigint): RlpWitness|null {
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
    return storageTrie.rlpSerializeWitness(ret);
  }

  getCode(address: Buffer, codeOnly: boolean):
      {code: Buffer|undefined, account: RlpWitness|undefined} {
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
    const rlpwitness = state.rlpSerializeWitness(witness);
    if (!rlpaccount) {
      if (codeOnly) {
        return {code: undefined, account: undefined};
      }
      return {code: undefined, account: rlpwitness};
    }
    const account = rlpToEthereumAccount(RlpDecode(rlpaccount) as RlpList);
    const codeHash = account.codeHash;
    const code = this._CodeStorage.get(codeHash);
    if (codeOnly) {
      return {code, account: undefined};
    }
    return {code, account: rlpwitness};
  }

  prove(root: Buffer, key: Buffer, witness: RlpWitness): boolean {
    verifyWitness(root, key, witness);
    return true;
  }
}
