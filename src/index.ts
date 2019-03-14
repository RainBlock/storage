import {decodeBlock, EthereumBlock} from '@rainblock/ethereum-block';
import {BatchPut, MerklePatriciaTree, RlpWitness, verifyWitness} from '@rainblock/merkle-patricia-tree';
import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, hashAsBuffer, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import {RlpDecode, RlpEncode, RlpList} from 'rlp-stream';

import {ethereumAccountToRlp, gethAccountToEthAccount, GethStateDumpAccount, getStateFromGethJSON} from './utils';

const nodeEthash = require('node-ethash');
const level = require('level-mem');
const ethjsBlock = require('ethereumjs-block');
const multiMap = require('multimap');

export interface Storage<K = Buffer, V = Buffer> {
  isEmpty: () => boolean;
  get: (key: Buffer, root?: Buffer) => RlpWitness;
  putGenesis: (genesisJSON?: string, genesisBIN?: string) => void;
  update: (block: RlpList, putOps: BatchPut[], delOps: Buffer[]) => void;
  prove: (root: Buffer, key: Buffer, witness: RlpWitness) => boolean;
  getRecentBlocks: () => Buffer[];
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

  _InternalStorage = new Map<bigint, MerklePatriciaTree<bigint, string>>();

  _CodeStorage = new Map<bigint, Buffer>();

  constructor(shard?: number, genesisJSON?: string, genesisBIN?: string) {
    const date = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    const filename = ('./logs/' + date + '.log').split(' ').join('');
    this._logFile = fs.createWriteStream(filename, {flags: 'a'});

    this._shard = (shard && shard >= 0 && shard < 16) ? shard : -1;
    this.putGenesis(genesisJSON, genesisBIN);
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

  get(key: Buffer, root?: Buffer): RlpWitness {
    const stateList: MerklePatriciaTree[]|MerklePatriciaTree =
        this._activeSnapshots.get(this._highestBlockNumber);
    if (root) {
      if (stateList instanceof Array) {
        for (const state of stateList) {
          if (state.root.compare(root) === 0) {
            return state.rlpSerializeWitness(state.get(key));
          }
        }
        const s = stateList.pop();
        return s!.rlpSerializeWitness(s!.get(key));
      } else {
        return stateList.rlpSerializeWitness(stateList.get(key));
      }
    } else {
      if (stateList instanceof Array) {
        const s = stateList.pop();
        return s!.rlpSerializeWitness(s!.get(key));
      } else {
        return stateList.rlpSerializeWitness(stateList.get(key));
      }
    }
  }

  private _updateStorageEntries(
      storage: GethStateDumpAccount['storage'], root: string, codeHash: string, code: string) {
    const storageEntries = Object.entries(storage);
    if (storageEntries.length > 0) {
      const internalTrie = new MerklePatriciaTree<bigint, string>({
        keyConverter: k => hashAsBuffer(HashType.KECCAK256, toBufferBE(k, 32)),
        valueConverter: v => Buffer.from(v, 'hex'),
        putCanDelete: false
      });
      for (const [key, value] of storageEntries) {
        internalTrie.put(BigInt(`0x${key}`), value);
      }
      this._InternalStorage.set(toBigIntBE(Buffer.from(root, 'hex')), internalTrie);

      const codeBuffer = Buffer.from(code, 'hex');
      const codeHashBuffer = Buffer.from(codeHash, 'hex')
      this._CodeStorage.set(toBigIntBE(codeHashBuffer), codeBuffer);
    }
  }

  putGenesis(genesisJSON?: string, genesisBIN?: string) {
    if (!this.isEmpty()) {
      throw new Error('Invalid: putGenesis when blockchain not empty');
    }
    const putOps = getStateFromGethJSON(
        __dirname + '/' +
        ((!genesisJSON) ? 'test_data/genesis.json' : genesisJSON));

    const trie = new MerklePatriciaTree<Buffer, GethStateDumpAccount>({
      keyConverter: k => hashAsBuffer(HashType.KECCAK256, k),
      valueConverter: v => ethereumAccountToRlp(gethAccountToEthAccount(v)),
      putCanDelete: false
    });
    // TODO: Partition the keys here before inserting into the global state
    trie.batch(putOps, []);
    for (const put of putOps) {
      this._updateStorageEntries(put.val.storage, put.val.root, put.val.codeHash, put.val.code);
    }

    const data = fs.readFileSync(
        __dirname + '/' +
        ((!genesisBIN) ? 'test_data/genesis.bin' : genesisBIN));
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

  /**
   * TODO: Change the interface to take in account modifications only in putOps
   * TODO: Process the storage entries in every account
   */
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

  getRecentBlocks(): Buffer[] {
    const retVal = [];
    const blockHashIterator = this._blockchain.keys();
    for (const hash of blockHashIterator) {
      retVal.push(hash);
    }
    return retVal;
  }

  prove(root: Buffer, key: Buffer, witness: RlpWitness): boolean {
    verifyWitness(root, key, witness);
    return true;
  }
}
