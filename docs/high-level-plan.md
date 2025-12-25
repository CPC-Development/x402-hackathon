create a Cheddr Payments Channel extension to x402 that allows for offchain payments to enable instant confirmations for x402 payments.


create a docker stack to demo the setup:
  - blockchain as hardhat similar to cpc-pos/backend/Dockerfile.hardhat
  - facilitator
  - sequencer
  - service


i am thinking the client itself should be "outside" for this demo and just instantiate
x402/apps/demo-client via tsx as a one-off script
