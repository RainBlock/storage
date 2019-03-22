# ☔️🌲 RainBlock's Storage Node

rainblock-storage implements the storage layer for Rainblock.
To run the tests or to boot up a storage server, install and compile the rainblock-storage and either execute the server or run the tests.
The instructions for each of the steps follows.

## Install

> git clone https://gitlab.com/SoujanyaPonnapalli/rainblock-storage \
> cd rainblock-storage \
> npm install

## Prepare and Compile

This repo has a submodule [rainblock-protocol](https://github.com/RainBlock/rainblock-protocol).

To first pull the protobufs from the remote git repo and then to compile the storage node:
> npm run prepare

If the protobufs are already present and to compile the storage node implementation only:
> npm run compile

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

## Run on a docker in a remote machine

A .gitlab-ci.yml is present in the folder to test the storage node build and implementation tests.

For manual testing; Use node:11.11.0 or node > 11; fetch the repo and run the following script in the repo:

> npm install \
> npm run prepare \
> npm run test