/** The list of storage nodes */
export interface StorageShards {
  /** Shard 0 storage node addresses */
  0: string;
  /** Shard 1 storage node addresses */
  1: string;
  /** Shard 2 storage node addresses */
  2: string;
  /** Shard 3 storage node addresses */
  3: string;
  /** Shard 4 storage node addresses */
  4: string;
  /** Shard 5 storage node addresses */
  5: string;
  /** Shard 6 storage node addresses */
  6: string;
  /** Shard 7 storage node addresses */
  7: string;
  /** Shard 8 storage node addresses */
  8: string;
  /** Shard 9 storage node addresses */
  9: string;
  /** Shard 10 storage node addresses */
  10: string;
  /** Shard 11 storage node addresses */
  11: string;
  /** Shard 12 storage node addresses */
  12: string;
  /** Shard 13 storage node addresses */
  13: string;
  /** Shard 14 storage node addresses */
  14: string;
  /** Shard 15 storage node addresses */
  15: string;
  // Indexer
  [key: number]: string;
}

/**
 * An interface which defines the contents of the parsed YAML configuration
 * file.
 */
export interface ConfigurationFile {
  shards: StorageShards;
  /** Path to the genesis block file, relative to the config file */
  genesisBlock: string;
  /**
   * Path to the genesis data file, exported by `geth dump`, relative to the
   * config file
   */
  genesisData: string;
  maxMsgSendLength: number;
  maxMsgReceiveLength: number;
}