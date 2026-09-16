import * as dotenv from 'dotenv';
import * as path from 'path';
import {
  createTagPerTrackTool,
  createTagPerTrackBatchTool,
  createLookupArtistStatsTool,
  AgentWallet,
} from './TagPerTrackTool';
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
  const privateKey = process.env.TEST_AGENT_PRIVATE_KEY || process.env.PRIVATE_KEY;
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
        console.log("Signing data:", data.message);
        // Serialize BigInt to string to avoid dropping them
        const safeMessage = JSON.parse(JSON.stringify(data.message, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        ));
        console.log("Safe message:", safeMessage);
        const result = await cdp.evm.signTypedData({
          address: account.address,
          domain: data.domain,
          types: data.types,
          primaryType: data.primaryType,
          message: safeMessage,
        });
        return result.signature as `0x${string}`;
      },
    };
  }

  throw new Error("No agent credentials found (set TEST_AGENT_PRIVATE_KEY, PRIVATE_KEY, or CDP_WALLET_SECRET).");
}

/**
 * Test script for the Tag-per-Track SDK Tools.
 */
async function runTest() {
  console.log("--------------------------------------------------");
  console.log("🚀 Initializing Tag-per-Track SDK Test (Base Mainnet)");
  console.log("--------------------------------------------------");

  const args = process.argv.slice(2);

  // Mode 1: Lookup Artist Stats (Free endpoint, no wallet required)
  const artistIndex = args.indexOf('--artist');
  if (artistIndex !== -1) {
    const artistName = args[artistIndex + 1];
    if (!artistName) {
      console.error("❌ Error: Missing artist name after --artist (e.g. --artist 'Daft Punk')");
      process.exit(1);
    }

    console.log(`\n🔍 Looking up Spotify traction metrics for: "${artistName}"...`);
    const artistTool = createLookupArtistStatsTool();
    const result = await artistTool.invoke({ artist_name: artistName });

    console.log("\n✅ Tool Output:");
    console.log(result);
    console.log("\n--------------------------------------------------");
    console.log("🎉 Artist stats lookup test completed successfully!");
    console.log("--------------------------------------------------");
    return;
  }

  // Audio Analysis modes require an agent wallet for x402 signing
  try {
    const wallet = await getAgentWallet();
    console.log(`🤖 Agent Wallet Address: ${wallet.address}`);

    const withLyrics = args.includes('--lyrics') || args.includes('-l');
    const isBatch = args.includes('--batch');

    // Mode 2: Batch Analysis
    if (isBatch) {
      const batchTool = createTagPerTrackBatchTool(wallet, {
        builderCode: process.env.BUILDER_CODE,
      });

      const items = args.filter(arg => !arg.startsWith('-'));
      const filePaths = items.filter(item => !item.startsWith('http://') && !item.startsWith('https://'));
      const fileUrls = items.filter(item => item.startsWith('http://') || item.startsWith('https://'));

      if (filePaths.length === 0 && fileUrls.length === 0) {
        fileUrls.push("https://www.learningcontainer.com/wp-content/uploads/2020/02/Sample-OGG-File.ogg");
      }

      console.log(`\n📡 Sending batch audio analysis request (${filePaths.length} local file(s), ${fileUrls.length} remote URL(s))...`);
      const response = await batchTool.invoke({
        filePaths: filePaths.length > 0 ? filePaths : undefined,
        fileUrls: fileUrls.length > 0 ? fileUrls : undefined,
        extractLyrics: withLyrics,
      });

      console.log("\n✅ Batch Tool Output:");
      console.log(response);
      console.log("\n--------------------------------------------------");
      console.log("🎉 Batch analysis test completed successfully!");
      console.log("--------------------------------------------------");
      return;
    }

    // Mode 3: Single Track Analysis
    const tagPerTrackTool = createTagPerTrackTool(wallet, {
      builderCode: process.env.BUILDER_CODE,
    });

    const inputArg = args.find(arg => !arg.startsWith('-'));
    let invokeParams: { filePath?: string; fileUrl?: string; extractLyrics?: boolean };

    if (inputArg) {
      if (inputArg.startsWith('http://') || inputArg.startsWith('https://') || inputArg.startsWith('ipfs://')) {
        invokeParams = { fileUrl: inputArg, extractLyrics: withLyrics };
      } else {
        invokeParams = { filePath: inputArg, extractLyrics: withLyrics };
      }
    } else if (process.env.TEST_AUDIO_FILE) {
      invokeParams = { filePath: process.env.TEST_AUDIO_FILE, extractLyrics: withLyrics };
    } else {
      const defaultUrl = process.env.TEST_AUDIO_URL || "https://www.learningcontainer.com/wp-content/uploads/2020/02/Sample-OGG-File.ogg";
      invokeParams = {
        fileUrl: defaultUrl,
        extractLyrics: withLyrics,
      };
    }

    console.log(`\n📡 Sending audio analysis request with params:`, invokeParams);
    const response = await tagPerTrackTool.invoke(invokeParams);

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
