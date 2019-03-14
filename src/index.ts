import {decodeBlock, EthereumBlock} from '@rainblock/ethereum-block';
import {BatchPut, MerklePatriciaTree, RlpWitness, verifyWitness} from '@rainblock/merkle-patricia-tree';
import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {hashAsBigInt, hashAsBuffer, HashType} from 'bigint-hash';
import * as fs from 'fs-extra';
import {RlpDecode, RlpEncode, RlpList} from 'rlp-stream';

import {EthereumAccount, ethereumAccountToRlp, gethAccountToEthAccount, GethStateDumpAccount, getStateFromGethJSON, rlpToEthereumAccount, UpdateOps} from './utils';

const nodeEthash = require('node-ethash');
const level = require('level-mem');
const ethjsBlock = require('ethereumjs-block');
const multiMap = require('multimap');

export interface Storage<K = Buffer, V = Buffer> {
  isEmpty: () => boolean;
  get: (key: Buffer, root?: Buffer) => RlpWitness;
  putGenesis: (genesisJSON?: string, genesisBIN?: string) => void;
  update: (block: RlpList, putOps: UpdateOps) => void;
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

  _InternalStorage = new Map<bigint, MerklePatriciaTree<bigint, bigint>>();

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

  private _updateGethStorage(
      storage: GethStateDumpAccount['storage'], root: string, codeHash: string,
      code: string) {
    const storageEntries = Object.entries(storage);
    if (storageEntries.length > 0) {
      const internalTrie = new MerklePatriciaTree<bigint, bigint>({
        keyConverter: k => hashAsBuffer(HashType.KECCAK256, toBufferBE(k, 20)),
        putCanDelete: false
      });
      for (const [key, value] of storageEntries) {
        const val = BigInt(`0x${value}`);
        internalTrie.put(BigInt(`0x${key}`), val);
      }
      this._InternalStorage.set(
          toBigIntBE(Buffer.from(root, 'hex')), internalTrie);

      const codeBuffer = Buffer.from(code, 'hex');
      const codeHashBuffer = Buffer.from(codeHash, 'hex');
      this._CodeStorage.set(toBigIntBE(codeHashBuffer), codeBuffer);
    }
  }

  private _updateStorageTrie(
      puts: Array<BatchPut<bigint, bigint>>, dels: Array<bigint>,
      internalTrie: MerklePatriciaTree<bigint, bigint>): bigint {
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
        __dirname + '/' +
        ((!genesisJSON) ? 'test_data/genesis.json' : genesisJSON));

    const trie = new MerklePatriciaTree<Buffer, EthereumAccount>({
      keyConverter: k => hashAsBuffer(HashType.KECCAK256, k),
      valueConverter: v => ethereumAccountToRlp(v),
      putCanDelete: false
    });
    const batchOps = [];
    for (const put of putOps) {
      if (this._shard === -1 || (Math.floor(put.key[0] / 16) === this._shard)) {
        batchOps.push({key: put.key, val: gethAccountToEthAccount(put.val)});
      }
    }
    trie.batch(batchOps, []);
    for (const put of putOps) {
      this._updateGethStorage(
          put.val.storage, put.val.root, put.val.codeHash, put.val.code);
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

  private persist(block: RlpList, putOps: UpdateOps) {
    this._logFile.write(RlpEncode(block).toString('hex') + '\n');
    for (const put of putOps.ops) {
      this._logFile.write(JSON.stringify(put));
    }
  }

  private partitionKeys(putOps: UpdateOps): UpdateOps {
    if (this._shard === -1) {
      return putOps;
    }
    const shardedPutOps = [];
    for (const put of putOps.ops) {
      const account = put.account;
      if (Math.floor(account[0] / 16) === this._shard) {
        shardedPutOps.push(put);
      }
    }
    return {ops: shardedPutOps};
  }

  /**
   * TODO: Change the interface to take in account modifications only in putOps
   * TODO: Process the storage entries in every account
   */
  update(rlpBlock: RlpList, putOps: UpdateOps) {
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
      if (Math.floor(put.account[0] / 16) !== this._shard &&
          this._shard !== -1) {
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
        const internalTrie = new MerklePatriciaTree<bigint, bigint>({
          keyConverter: k =>
              hashAsBuffer(HashType.KECCAK256, toBufferBE(k, 20)),
          putCanDelete: false
        });
        const puts: Array<BatchPut<bigint, bigint>> = [];
        put.storage.forEach((key, value, map) => {
          puts.push({key, val: value});
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
        const puts: Array<BatchPut<bigint, bigint>> = [], dels = [];
        for (const op of put.storageUpdates) {
          if (op.type === 'StorageInsertion') {
            puts.push(op);
          } else if (op.type === 'StorageDeletion') {
            dels.push(op.key);
          }
        }
        const storageRoot = this._updateStorageTrie(puts, dels, storage!);
        account.storageRoot = storageRoot;
        updateOps.push({key: put.account, val: ethereumAccountToRlp(account)});
      }
    }

    const trie = parentState.batchCOW(updateOps, delOps);
    const root = toBigIntBE(trie.root);
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
