import { ethers } from "hardhat";

function envAddress(key: string, fallback: string): string {
  const value = process.env[key];
  if (!value) {
    return fallback;
  }
  return value;
}

function envBigInt(key: string, fallback: bigint): bigint {
  const value = process.env[key];
  if (!value) {
    return fallback;
  }
  return BigInt(value);
}

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const sequencer = envAddress("SEQUENCER_ADDRESS", deployer.address);
  const client = envAddress("CLIENT_ADDRESS", deployer.address);
  const initialSupply = envBigInt("USDC_INITIAL_SUPPLY", 1_000_000_000_000n); // 1,000,000 USDC (6 decimals)

  const TestUSDC = await ethers.getContractFactory("TestUSDC");
  const usdc = await TestUSDC.deploy(client, initialSupply);
  await usdc.waitForDeployment();

  const X402CheddrPaymentChannel = await ethers.getContractFactory("X402CheddrPaymentChannel");
  const channel = await X402CheddrPaymentChannel.deploy(await usdc.getAddress(), sequencer);
  await channel.waitForDeployment();

  const result = {
    deployer: deployer.address,
    usdc: await usdc.getAddress(),
    channelManager: await channel.getAddress(),
    sequencer,
    client,
    usdcInitialSupply: initialSupply.toString()
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
