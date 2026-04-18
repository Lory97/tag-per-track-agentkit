import * as dotenv from 'dotenv';
import * as path from 'path';
import { CdpClient } from '@coinbase/cdp-sdk';

// Load environment variables from the local SDK directory
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Provisions a Server-Managed Coinbase CDP Wallet for the agent.
 * Defaults to Base Mainnet. Use --testnet to provision on Base Sepolia and use the faucet.
 */
async function setupWallet() {
  const isTestnet = process.argv.includes('testnet') || process.argv.includes('--testnet');
  const networkName = isTestnet ? 'Base Sepolia' : 'Base Mainnet';

  console.log("--------------------------------------------------");
  console.log(`🚀 Provisioning Agent Wallet via Coinbase CDP Client (${networkName})`);
  console.log("--------------------------------------------------");

  const apiKeyId = process.env.CDP_API_KEY_NAME;
  const apiKeySecret = process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const walletSecret = process.env.CDP_WALLET_SECRET;

  if (!apiKeyId || !apiKeySecret || !walletSecret) {
    console.error("❌ Error: Missing CDP_API_KEY_NAME, CDP_API_KEY_PRIVATE_KEY, or CDP_WALLET_SECRET.");
    process.exit(1);
  }

  const cdp = new CdpClient({
    apiKeyId,
    apiKeySecret,
    walletSecret,
  });

  try {
    // 1. Retrieve or Create the Server-Managed EVM Account
    const accountName = "TagPerTrack-Agent-Managed";
    console.log(`🛠️ Synchronizing account '${accountName}' on ${networkName}...`);
    
    let account;
    try {
        account = await cdp.evm.getAccount({ name: accountName });
        console.log(`✅ Existing account found.`);
    } catch (e) {
        account = await cdp.evm.createAccount({ name: accountName });
        console.log(`✅ New account created.`);
    }
    
    console.log(`📍 Address: ${account.address}`);

    if (isTestnet) {
      // 2. Request ETH Faucet for Gas
      console.log("\n🚰 Requesting ETH Faucet for Gas...");
      try {
          const ethResult = await cdp.evm.requestFaucet({
              address: account.address,
              network: 'base-sepolia',
              token: 'eth'
          });
          console.log(`✅ ETH requested! TX Hash: ${ethResult.transactionHash}`);
      } catch (e: any) {
          console.warn("ℹ️ ETH Faucet status:", e.message);
      }

      // 3. Request USDC Faucet for micro-payments
      console.log("\n🚰 Requesting USDC Faucet...");
      try {
          const usdcResult = await cdp.evm.requestFaucet({
              address: account.address,
              network: 'base-sepolia',
              token: 'usdc'
          });
          console.log(`✅ USDC requested! TX Hash: ${usdcResult.transactionHash}`);
      } catch (e: any) {
          console.warn("ℹ️ USDC Faucet status:", e.message);
      }
    } else {
      console.log("\n⚠️ IMPORTANT: You are operating on Base Mainnet.");
      console.log(`Please manually send some ETH (for gas) and USDC (for payments) to the following address:`);
      console.log(`-> ${account.address}`);
    }

    console.log("\n--------------------------------------------------");
    console.log("🎉 Configuration Complete!");
    console.log(`Wallet '${accountName}' is set up for ${networkName}.`);
    console.log("--------------------------------------------------");

  } catch (error: any) {
    console.error("\n❌ Setup failed:");
    console.error(error.message);
  }
}

setupWallet().catch(console.error);
