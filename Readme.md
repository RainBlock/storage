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

Run to get the server usage instructions

> node -r ts-node/register src/server.ts

To run a fullNode on port 50051

> node -r ts-node/register src/server.ts -1 50051

## Run on a docker in a remote machine

A .gitlab-ci.yml is present in the folder to test the storage node build and implementation tests.

For manual testing; Use node:11.11.0 or node > 11; fetch the repo and run the following script in the repo:

> npm install
> npm run prepare
> npm run test
