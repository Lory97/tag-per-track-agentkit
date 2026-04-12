import * as dotenv from 'dotenv';
import * as path from 'path';
import { createTagPerTrackTool, AgentWallet } from './TagPerTrackTool';
import { CdpClient } from '@coinbase/cdp-sdk';
import { privateKeyToAccount } from 'viem/accounts';

// Load environment variables from the local SDK directory
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Retrieves or creates the wallet for the agent.
 * Supports either a local private key or a Coinbase CDP (Server-Side) managed wallet.
 */
async function getAgentWallet(): Promise<AgentWallet> {
  const privateKey = process.env.TEST_AGENT_PRIVATE_KEY;
  const cdpWalletSecret = process.env.CDP_WALLET_SECRET;

  // Option A: Use a local private key (if provided)
  if (privateKey) {
    console.log("📍 Using local private key for the agent.");
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    return {
      address: account.address,
      signTypedData: async (data: any) => {
        return await account.signTypedData(data);
      },
    };
  }

  // Option B: Use a Coinbase CDP Server-Managed Wallet
  if (cdpWalletSecret) {
    console.log("📍 Using Coinbase CDP Server-Managed Wallet.");
    const apiKeyId = process.env.CDP_API_KEY_NAME;
    const apiKeySecret = process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!apiKeyId || !apiKeySecret) {
      throw new Error("Missing CDP_API_KEY_NAME or CDP_API_KEY_PRIVATE_KEY in environment.");
    }

    const cdp = new CdpClient({
      apiKeyId,
      apiKeySecret,
      walletSecret: cdpWalletSecret,
    });

    // Retrieve the existing account or create it if not found
    const account = await cdp.evm.getAccount({ name: "TagPerTrack-Agent-Managed" });

    return {
      address: account.address as `0x${string}`,
      signTypedData: async (data: any) => {
        const result = await cdp.evm.signTypedData({
          address: account.address,
          domain: data.domain,
          types: data.types,
          primaryType: data.primaryType,
          message: data.message,
        });
        return result.signature as `0x${string}`;
      },
    };
  }

  throw new Error("No agent credentials found (set TEST_AGENT_PRIVATE_KEY or CDP_WALLET_SECRET).");
}

/**
 * Test script for the Tag-per-Track SDK Tool.
 */
async function runTest() {
  console.log("--------------------------------------------------");
  console.log("🚀 Initializing Tag-per-Track SDK Test (Base Sepolia)");
  console.log("--------------------------------------------------");

  try {
    // 1. Initialize the agent's wallet
    const wallet = await getAgentWallet();
    console.log(`🤖 Agent Wallet Address: ${wallet.address}`);

    // 2. Create the LangChain tool with the wallet and Builder Code attribution
    const tagPerTrackTool = createTagPerTrackTool(wallet, {
      builderCode: process.env.BUILDER_CODE, // ERC-8021 attribution
    });

    // 3. Simulate an AI agent calling the tool
    console.log("\n📡 Sending audio analysis request...");
    const testFileUrl = "https://www.learningcontainer.com/wp-content/uploads/2020/02/Sample-OGG-File.ogg";

    const response = await tagPerTrackTool.invoke({ fileUrl: testFileUrl });

    console.log("\n✅ Tool Output:");
    console.log(response);
    console.log("\n--------------------------------------------------");
    console.log("🎉 Test completed successfully!");
    console.log("--------------------------------------------------");

  } catch (error: any) {
    console.error("\n❌ Test failed with error:");
    console.error(error.message);
    process.exit(1);
  }
}

runTest().catch(console.error);
