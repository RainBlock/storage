# ☔️🌲📦 RainBlock's Storage Node

Storage implements the storage layer for Rainblock.

To boot up Rainblock's storage node, install storage and follow the instructions below:

## Install

> git clone https://github.com/RainBlock/storage \
> cd storage \
> npm install

## Test

> npm run test

## Server Execution

Usage instructions, run the server with two args shard and port.

> node -r ts-node/register src/server.ts shard port

Shard can be either -1 or any number between 0 to 15.
If shard is -1, the storage node is a fullNode and a sharded node storing the {shard} otherwise.

Port is the port on the storage server has to run.

For example, to run a fullNode on port 50051

> node -r ts-node/register src/server.ts -1 50051
