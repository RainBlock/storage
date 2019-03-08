import {BatchPut, MerklePatriciaTree, RlpWitness, verifyWitness, Witness} from '@rainblock/merkle-patricia-tree';

const ethBlock = require('ethereumjs-block');
const ethHash = require('ethashjs');
const level = require('level-mem');

export interface Storage<K, V> {
  isEmpty: () => boolean;
  get: (key: K, root?: Buffer) => Witness<V>;
  putGenesis: (genesis, putOps: BatchPut[]) => void;
  update: (block, putOps: BatchPut[], delOps: K[]) => void;
  getBlockByNumber(blockNum: number);
  getBlockByHash(hash: Buffer);
  prove: (root: Buffer, key: Buffer, witness: RlpWitness) => boolean;
}

/**
 * TODO : PersistUpdates
 */
export class StorageNode<K = Buffer, V = Buffer> implements Storage<K, V> {
  _shard: number;

  _blockchain = new Map();

  _rootMap = new Map();

  _blockNumberToHash = new Map();

  _activeSnapshots: MerklePatriciaTree[] = [];

  _gcThreshold = 256;

  constructor(shard?: number, genesis?, putOps?: BatchPut[]) {
    this._shard = (shard && shard >= 0 && shard < 16) ? shard : -1;
    if (genesis && putOps) {
      this.putGenesis(genesis, putOps);
    }
  }

  private validateProofOfWork(block, root?: Buffer) {
    const ethash = new ethHash(level());
    ethash.verifyPOW(block, (valid: boolean) => {
      if (!valid) {
        throw new Error('Invalid Block');
      }
    });
    if (root) {
      const blockStateRoot = block.header.stateRoot;
      if (root.compare(blockStateRoot) !== 0) {
        throw new Error('Block and State root mismatch');
      }
    }
  }

  isEmpty(): boolean {
    if (this._blockchain.size !== 0 || this._rootMap.size !== 0 ||
        this._blockNumberToHash.size !== 0 ||
        this._activeSnapshots.length !== 0) {
      return false;
    }
    return true;
  }

  get(key: K, root?: Buffer): Witness<V> {
    let state;
    if (root && this._rootMap.has(root)) {
      const val = this._rootMap.get(root);
      state = val[1];
    } else {
      const len = this._activeSnapshots.length;
      state = this._activeSnapshots[len - 1];
    }
    return state.get(key);
  }

  putGenesis(genesis, putOps: BatchPut[]) {
    if (!this.isEmpty()) {
      throw new Error('Invalid: putGenesis when Blockchain not empty');
    }

    const trie = new MerklePatriciaTree();
    const root = trie.batch(putOps);
    this.validateProofOfWork(genesis, root);

    const blockNum = genesis.header.blockNumber;
    const blockHash = genesis.header.hash().toString('hex');
    this._blockchain.set(blockHash, [genesis, trie]);
    this._rootMap.set(root, [blockHash, trie]);
    this._blockNumberToHash.set(blockNum, blockHash);
    this._activeSnapshots.push(trie);
  }

  private _deleteFirstInMap(map: Map<K, V>): V|undefined {
    const keys = map.keys();
    for (const key of keys) {
      const value = map.get(key);
      map.delete(key);
      return value;
    }
    return undefined;
  }

  private gc() {
    if (this._activeSnapshots.length <= this._gcThreshold) {
      return;
    }
    const gcNumber = this._activeSnapshots.length - this._gcThreshold;
    for (let i = 0; i < gcNumber; i++) {
      global.gc();
      this._activeSnapshots.shift();
      this._deleteFirstInMap(this._blockchain);
      this._deleteFirstInMap(this._rootMap);
      this._deleteFirstInMap(this._blockNumberToHash);
      // TODO: Cross check if we deleted all related values
    }
  }

  private persist(block, putOps: BatchPut[], delOps: K[]) {}

  private partitionKeys(putOps: BatchPut[], delOps: K[]) {
    return [putOps, delOps];
  }

  update(block, putOps: BatchPut[], delOps: K[]) {
    this.gc();
    this.validateProofOfWork(block);
    const parentHash = block.header.parent.toString('hex');
    let parentState = this._blockchain.get(parentHash);
    if (parentState) {
      parentState = parentState[1];
    } else {
      throw new Error('Cannot find parent state');
    }
    const keys = this.partitionKeys(putOps, delOps);
    const trie = parentState.batchCOW(keys[0], keys[1]);
    const root = trie.root;
    const blockNum = block.header.blockNumber;
    const blockHash = block.header.hash().toString('hex');
    this._blockchain.set(blockHash, [block, trie]);
    this._rootMap.set(root, [blockHash, trie]);
    this._blockNumberToHash.set(blockNum, blockHash);
    this._activeSnapshots.push(trie);
    this.persist(block, putOps, delOps);
  }

  getBlockByNumber(blockNum: number) {
    const hash = this._blockNumberToHash.get(blockNum);
    return this.getBlockByHash(hash);
  }

  getBlockByHash(hash: Buffer) {
    const value = this._blockchain.get(hash.toString('hex'));
    return value[0];
  }

  prove(root: Buffer, key: Buffer, witness: RlpWitness): boolean {
    verifyWitness(root, key, witness);
    return true;
  }
}