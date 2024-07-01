#!/usr/bin/env bash

export DEVNET_RPC='http://0.0.0.0:7799'
export DEVNET_PUBSUB='http://0.0.0.0:7800'
export EPHEM_RPC='http://0.0.0.0:8899'
export EPHEM_PUBSUB='http://0.0.0.0:8900'

anchor test \
  --skip-build --skip-deploy --skip-local-validator
