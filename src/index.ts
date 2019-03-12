import {decodeBlock, EthereumBlock} from '@rainblock/ethereum-block';
import {BatchPut, MerklePatriciaTree, RlpWitness, verifyWitness, Witness} from '@rainblock/merkle-patricia-tree';
import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import {RlpEncode, RlpList} from 'rlp-stream';

const nodeEthash = require('node-ethash');
const level = require('level-mem');
const ethjsBlock = require('ethereumjs-block');
const multiMap = require('multimap');

export interface Storage<K = Buffer, V = Buffer> {
  isEmpty: () => boolean;
  get: (key: Buffer, root?: Buffer) => Witness<V>;
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

  _cacheDB = new level();

  _logFile: fs.WriteStream;

  _lowestBlockNumber = -1n;

  _highestBlockNumber = -1n;

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
        this._activeSnapshots.size !== 0) {
      return false;
    }
    return true;
  }

  get(key: Buffer, root?: Buffer): Witness<Buffer> {
    const stateList: MerklePatriciaTree[]|MerklePatriciaTree =
        this._activeSnapshots.get(this._highestBlockNumber);
    if (root) {
      if (stateList instanceof Array) {
        for (const state of stateList) {
          if (state.root.compare(root) === 0) {
            return state.get(key);
          }
        }
        return stateList.pop()!.get(key);
      } else {
        return stateList.get(key);
      }
    } else {
      if (stateList instanceof Array) {
        return stateList.pop()!.get(key);
      } else {
        return stateList.get(key);
      }
    }
  }

  putGenesis(rlpGenesis: RlpList, putOps: BatchPut[]) {
    const genesis: EthereumBlock = decodeBlock(rlpGenesis);
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
    if (this._shard === -1) {
      return [putOps, delOps];
    }
    const shardedPutOps = [], shardedDelOps = [];
    for (const put of putOps) {
      if (Math.floor(put.key[0] / 16) === this._shard) {
        shardedPutOps.push(put);
      }
    }
    for (const key of delOps) {
      if (Math.floor(key[0] / 16) === this._shard) {
        shardedDelOps.push(key);
      }
    }
    return [shardedPutOps, shardedDelOps];
  }

  update(rlpBlock: RlpList, putOps: BatchPut[], delOps: Buffer[]) {
    this.gc();
    const block: EthereumBlock = decodeBlock(rlpBlock);
    this.verifyPOW(rlpBlock);
    const parentHash = block.header.parentHash;
    const parentState: MerklePatriciaTree =
        (this._blockchain.get(parentHash)[0])![1];
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
    this._activeSnapshots.set(blockNum, trie);
    this.persist(rlpBlock, putOps, delOps);
    this._highestBlockNumber = (this._highestBlockNumber > blockNum) ?
        this._highestBlockNumber :
        blockNum;
  }

  prove(root: Buffer, key: Buffer, witness: RlpWitness): boolean {
    verifyWitness(root, key, witness);
    return true;
  }
}
