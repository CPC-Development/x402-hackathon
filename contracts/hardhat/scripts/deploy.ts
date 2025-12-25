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
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const sequencerSigner = signers[1] ?? deployer;
  const clientSigner = signers[2] ?? deployer;
  const sequencer = envAddress("SEQUENCER_ADDRESS", sequencerSigner.address);
  const client = envAddress("CLIENT_ADDRESS", clientSigner.address);
  const initialSupply = envBigInt("USDC_INITIAL_SUPPLY", 1_000_000_000_000n); // 1,000,000 USDC (6 decimals)

  const TestUSDC = await ethers.getContractFactory("TestUSDC");
  const usdc = await TestUSDC.deploy(client, initialSupply);
  await usdc.waitForDeployment();

  const X402CheddrPaymentChannel = await ethers.getContractFactory("X402CheddrPaymentChannel");
  const channel = await X402CheddrPaymentChannel.deploy(await usdc.getAddress(), sequencer);
  await channel.waitForDeployment();

  const channelAddress = await channel.getAddress();
  const usdcAddress = await usdc.getAddress();
  const expectedChannelAddress = process.env.CHANNEL_MANAGER_ADDRESS;
  const expectedUsdcAddress = process.env.USDC_ADDRESS;
  if (
    expectedChannelAddress &&
    channelAddress.toLowerCase() !== expectedChannelAddress.toLowerCase()
  ) {
    throw new Error(
      `CHANNEL_MANAGER_ADDRESS mismatch: expected ${expectedChannelAddress}, got ${channelAddress}`
    );
  }
  if (expectedUsdcAddress && usdcAddress.toLowerCase() !== expectedUsdcAddress.toLowerCase()) {
    throw new Error(`USDC_ADDRESS mismatch: expected ${expectedUsdcAddress}, got ${usdcAddress}`);
  }

  const result = {
    deployer: deployer.address,
    usdc: usdcAddress,
    channelManager: channelAddress,
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
