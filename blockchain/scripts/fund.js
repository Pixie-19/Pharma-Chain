// Fund any address with test ETH from Hardhat's Account #0
// Usage: npx hardhat run scripts/fund.js --network localhost

import hre from "hardhat";

async function main() {
  const [funder] = await hre.ethers.getSigners(); // Account #0 (10,000 ETH)

  // The address to fund — change this to your MetaMask wallet address
  const recipient = process.env.FUND_ADDRESS || "0xE9B54cb7e91Aa4A5552076c220f266D3d837f3A8";
  const amount = hre.ethers.parseEther("100"); // 100 ETH

  console.log(`Funding ${recipient} with 100 ETH from ${funder.address}...`);

  const tx = await funder.sendTransaction({ to: recipient, value: amount });
  await tx.wait();

  const balance = await hre.ethers.provider.getBalance(recipient);
  console.log(`✅ Done! ${recipient} now has ${hre.ethers.formatEther(balance)} ETH`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
