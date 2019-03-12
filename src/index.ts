import {decodeBlock, EthereumBlock, EthereumBlockDecoderError} from '@rainblock/ethereum-block';
import {BatchPut, MerklePatriciaTree, RlpWitness, verifyWitness, Witness} from '@rainblock/merkle-patricia-tree';
import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import {RlpEncode, RlpList} from 'rlp-stream';

const nodeEthash = require('node-ethash');
const level = require('level-mem');
const ethjsBlock = require('ethereumjs-block');

export interface Storage<K = Buffer, V = Buffer> {
  isEmpty: () => boolean;
  get: (key: Buffer, blockHash?: BigInt) => Witness<V>;
  putGenesis: (genesis: RlpList, putOps: BatchPut[]) => void;
  update: (block: RlpList, putOps: BatchPut[], delOps: Buffer[]) => void;
  prove: (root: Buffer, key: Buffer, witness: RlpWitness) => boolean;
  // TODO: getBlockByHash, getBlockByNumber (get Recent 256!)
}

export function computeBlockHash(block: RlpList): bigint {
  const blockBuffer = RlpEncode(block[0]);
  const hash = hashAsBigInt(HashType.KECCAK256, blockBuffer);
  return hash;
}

export class StorageNode<K = Buffer, V = Buffer> implements
    Storage<Buffer, Buffer> {
  _shard: number;

  _blockchain = new Map<BigInt, [EthereumBlock, MerklePatriciaTree]>();

  _blockNumberToHash = new Map<BigInt, BigInt>();

  _activeSnapshots: MerklePatriciaTree[] = [];

  _gcThreshold = 256;

  _cacheDB = new level();

  _logFile: fs.WriteStream;

  constructor(shard?: number, genesis?: RlpList, putOps?: BatchPut[]) {
    const date = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    const filename = ('./logs/' + date + '.log').split(' ').join('');
    this._logFile = fs.createWriteStream(filename, {flags: 'a'});

    this._shard = (shard && shard >= 0 && shard < 16) ? shard : -1;
    if (genesis && putOps) {
      this.putGenesis(genesis, putOps);
    }
  }

  verifyPOW(block: RlpList) {
    const _ethash = new nodeEthash(this._cacheDB);
    const ethBlock = new ethjsBlock(block);
    const blockNumber = ethBlock.header.number.toString('hex') + '\n';
    _ethash.verifyPOW(ethBlock, (result: boolean) => {
      this._logFile.write(
          result ? 'Valid ' + blockNumber : 'Invalid ' + blockNumber);
    });
  }

  isEmpty(): boolean {
    if (this._blockchain.size !== 0 || this._blockNumberToHash.size !== 0 ||
        this._activeSnapshots.length !== 0) {
      return false;
    }
    return true;
  }

  get(key: Buffer, blockHash?: BigInt): Witness<Buffer> {
    let state: MerklePatriciaTree;
    if (blockHash && this._blockchain.has(blockHash)) {
      const val = this._blockchain.get(blockHash);
      state = val![1];
    } else {
      const len = this._activeSnapshots.length;
      state = this._activeSnapshots[len - 1];
    }
    return state.get(key);
  }

  putGenesis(rlpGenesis: RlpList, putOps: BatchPut[]) {
    const genesis = decodeBlock(rlpGenesis);
    if (!this.isEmpty()) {
      throw new Error('Invalid: putGenesis when Blockchain not empty');
    }

    const trie = new MerklePatriciaTree();
    const root = toBigIntBE(trie.batch(putOps));
    this.verifyPOW(rlpGenesis);
    this.persist(rlpGenesis, putOps, []);

    const blockNum = genesis.header.blockNumber;
    const blockHash = computeBlockHash(rlpGenesis);
    this._blockchain.set(blockHash, [genesis, trie]);
    this._blockNumberToHash.set(blockNum, blockHash);
    this._activeSnapshots.push(trie);
  }

  private _deleteFirstInMap(
      map: Map<BigInt, BigInt|[EthereumBlock, MerklePatriciaTree]>) {
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
      this._deleteFirstInMap(this._blockNumberToHash);
      // TODO: Cross check if we deleted all related values
    }
  }

  private persist(block: RlpList, putOps: BatchPut[], delOps: Buffer[]) {
    this._logFile.write(RlpEncode(block).toString('hex') + '\n');
    const puts = [];
    for (const put of putOps) {
      puts.push([put.key, put.val]);
    }
    this._logFile.write(RlpEncode(puts).toString('hex') + '\n');
    this._logFile.write(RlpEncode(delOps).toString('hex') + '\n');
  }

  private partitionKeys(putOps: BatchPut[], delOps: Buffer[]):
      [BatchPut[], Buffer[]] {
    return [putOps, delOps];
  }

  update(rlpBlock: RlpList, putOps: BatchPut[], delOps: Buffer[]) {
    this.gc();
    const block = decodeBlock(rlpBlock);
    this.verifyPOW(rlpBlock);
    const parentHash = block.header.parentHash;
    const parentState: MerklePatriciaTree =
        this._blockchain.get(parentHash)![1];
    if (!parentState) {
      throw new Error('Cannot find parent state');
    }
    const keys = this.partitionKeys(putOps, delOps);
    const trie = parentState.batchCOW(keys[0], keys[1]);
    const root = toBigIntBE(trie.root);
    const blockNum = block.header.blockNumber;
    const blockHash = computeBlockHash(rlpBlock);
    this._blockchain.set(blockHash, [block, trie]);
    this._blockNumberToHash.set(blockNum, blockHash);
    this._activeSnapshots.push(trie);
    this.persist(rlpBlock, putOps, delOps);
  }

  prove(root: Buffer, key: Buffer, witness: RlpWitness): boolean {
    verifyWitness(root, key, witness);
    return true;
  }
}
