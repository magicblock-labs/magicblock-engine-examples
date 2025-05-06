export PROVIDER_ENDPOINT=http://localhost:8899
export WS_ENDPOINT=ws://localhost:8900

anchor test --provider.cluster http://localhost:7799 \
  --skip-deploy \
  --skip-build
