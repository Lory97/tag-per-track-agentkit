# Tag-per-Track AgentKit Tool 🎸🤖

An **Agentic-First** LangChain/AgentKit tool designed to enable AI Agents to perform advanced audio analysis while handling on-chain micro-payments autonomously via the **x402 protocol** (HTTP 402 Payment Required).

## 🌟 Overview

This tool allows AI agents to submit audio files (via URL) to the Tag-per-Track API. In exchange for a small fee (e.g., 0.05 USDC on Base Sepolia), the agent receives a rich JSON payload containing:
- **BPM** & **Rhythm**
- **Key** & **Scale**
- **Genres** (with confidence scores)
- **Moods** & **Instruments**

What makes this unique is that the agent handles the payment itself using a **Server-Managed Coinbase CDP Wallet**, signing an **EIP-3009 TransferWithAuthorization** without any human intervention.

## 🚀 Key Features

- **Standardized Payment**: Implements the x402 standard for frictionless monetized APIs.
- **Coinbase CDP Integrated**: Native support for Coinbase SDK Managed Wallets.
- **Agentic Signing**: Uses EIP-712 typed data signing for secure, gasless-for-user transactions.
- **LangChain Compatible**: Ready to be plugged into any `AgentExecutor` or LangChain agent.

## 🛠 Prerequisites

- **Base Sepolia**: The current implementation runs on the Base Sepolia testnet.
- **USDC (Base Sepolia)**: Ensure your agent's wallet has USDC.
- **Coinbase CDP API Keys**: You need `CDP_API_KEY_NAME` and `CDP_API_KEY_PRIVATE_KEY`.

## 📦 Setup

### 1. Installation

```bash
cd sdk
npm install
```

### 2. Environment Variables

Create a `sdk/.env.local` file:

```env
# Coinbase CDP Credentials (from your project dashboard)
CDP_API_KEY_NAME="organizations/..."
CDP_API_KEY_PRIVATE_KEY="-----BEGIN ANY KEY-----..."

# The Seed for your agent's persistent wallet (keep this safe!)
CDP_WALLET_SECRET="your-cdp-shared-secret"
```

### 3. Faucet (Provisioning)

If it's your agent's first time, run the faucet script to create the wallet and request test funds (ETH and USDC):

```bash
npm run faucet
```

## 💻 Usage Example

To use this tool, your agent needs a wallet capable of signing EIP-712 messages (e.g., using Viem or Coinbase CDP SDK).
```typescript
import { createTagPerTrackTool } from './TagPerTrackTool';
import { cdpWallet } from './your-cdp-config'; // Custom CDP setup

// 1. Initialize your agent's tool
const tagPerTrackTool = createTagPerTrackTool(cdpWallet);

// 2. Add to LangChain Agent tools array
const tools = [tagPerTrackTool, ...otherTools];

// 3. The Agent can now analyze music!
// Prompt: "Analyze the genre and BPM of this track: https://example.com/song.mp3"
```

## ⚡ How it Works (The x402 Cycle)

1. **Initial Call**: The Agent calls the API without a proof. The API returns `HTTP 402 Payment Required` along with payment instructions.
2. **Challenge Extraction**: The `TagPerTrackTool` parses the `paymentRequirements` (amount, asset, payTo).
3. **EIP-3009 Signing**: The agent signs a `TransferWithAuthorization` EIP-712 message using its CDP-managed wallet.
4. **Resubmission**: The tool sends a second request with the signed `X-Payment-Proof` header.
5. **Verification & Execution**: The backend verifies the signature on-chain, settles the payment, and triggers the audio analysis.

## 🛠 Scripts

- `npm run test:connector`: Runs a full end-to-end test of the tool.
- `npm run faucet`: Provisions the agent's wallet on Base Sepolia.
- `npm run build`: Compiles the TypeScript code.

## API Documentation & Under the Hood

This SDK is a wrapper around the core Tag-per-Track API. 
If you want to explore the underlying REST endpoints, inspect the precise JSON schemas returned by our Essentia/TensorFlow models, or test the inference manually, check out our interactive Swagger UI:

👉 **[Tag-per-Track API Swagger Documentation](https://api.tag-per-track.cloud/api/docs)**

---

Built for the **Agentic Commerce** era. 🚀
