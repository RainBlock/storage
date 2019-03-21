# ☔️🌲 RainBlock's Storage Node

rainblock-storage implements the storage layer for Rainblock.
To run the tests or to boot up a storage server, install and compile the rainblock-storage and either execute the server or run the tests.
The instructions for each of the steps follows.

## Install

> git clone https://gitlab.com/SoujanyaPonnapalli/rainblock-storage \
> cd rainblock-storage \
> npm install

## Compile

> npm run compile

## Test

> npm run test

## Server Execution

Run to get the server usage instructions

> node -r ts-node/register src/server.ts

To run a fullNode on port 50051

> node -r ts-node/register src/server.ts -1 50051
