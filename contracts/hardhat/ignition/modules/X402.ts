import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const X402Module = buildModule("X402Module", (m) => {
  const sequencer = m.getAccount(1);
  const client = m.getAccount(2);
  const usdcInitialSupply = m.getParameter("usdcInitialSupply", 1_000_000_000_000n);

  const usdc = m.contract("TestUSDC", [client, usdcInitialSupply]);
  const channel = m.contract("X402CheddrPaymentChannel", [usdc, sequencer]);

  return { usdc, channel, sequencer, client };
});

export default X402Module;
