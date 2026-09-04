# Tag-per-Track AgentKit Tool 🎸🤖

An **Agentic-First** LangChain/AgentKit tool designed to enable AI Agents to perform advanced audio analysis while handling on-chain micro-payments autonomously via the **x402 protocol** (HTTP 402 Payment Required).

## 🌟 Overview

This tool allows AI agents to analyze audio tracks either from **local files on disk** (`filePath`) or from **remote URLs** (`fileUrl`). In exchange for a micro-payment (e.g., 0.05 USDC for standard metadata, or 0.10 USDC with lyrics extraction on Base), the agent receives a rich JSON payload containing:
- **BPM** & **Rhythm**
- **Key** & **Scale**
- **Genres** (with confidence scores)
- **Moods** & **Instruments**
- **Lyrics** (AI speech-to-text vocal transcription when `extractLyrics` is enabled)

What makes this unique is that the agent handles the payment itself using a **Server-Managed Coinbase CDP Wallet** or local private key, signing an **EIP-3009 TransferWithAuthorization** without any human intervention.

## 🚀 Key Features

- **Standardized Payment**: Implements the x402 standard for frictionless monetized APIs.
- **Local Binary Files & Remote URLs**: Supports local audio files (`filePath`) uploaded via `multipart/form-data` as well as remote URLs (`fileUrl`).
- **Pre-Payment Safety Validation**: Validates file existence, regular file status, and size limit (50 MB) **before** requesting or signing x402 payments to protect agent funds.
- **Intelligent Path Detection**: Automatically converts local filesystem paths or `file://` URLs provided in `fileUrl` to binary uploads.
- **Lyrics & Audio Metadata**: Extracts musical tags and transcribes full vocal lyrics.
- **Coinbase CDP Integrated**: Native support for Coinbase SDK Managed Wallets.
- **Agentic Signing**: Uses EIP-712 typed data signing for secure, gasless-for-user transactions.
- **LangChain Compatible**: Ready to be plugged into any `AgentExecutor` or LangChain agent.

## 🛠 Prerequisites

- **Base Mainnet / Base Sepolia**: The tool runs on Base (Mainnet or Sepolia).
- **USDC**: Ensure your agent's wallet has USDC on the selected network.
- **Coinbase CDP API Keys**: You need `CDP_API_KEY_NAME` and `CDP_API_KEY_PRIVATE_KEY` (or a local private key).

## 📦 Setup

### 1. Installation

```bash
npm install
```

### 2. Environment Variables

Create a `.env.local` file at the project root:

```env
# Coinbase CDP Credentials (from your project dashboard)
CDP_API_KEY_NAME="organizations/..."
CDP_API_KEY_PRIVATE_KEY="-----BEGIN ANY KEY-----..."

# The Seed for your agent's persistent wallet (keep this safe!)
CDP_WALLET_SECRET="your-cdp-shared-secret"
```

### 3. Wallet Setup (Provisioning)

If it's your agent's first time, run the setup script to create the wallet. Once created, you will need to manually send some ETH (for gas) and USDC (for payments) to the generated address on Base Mainnet:

```bash
npm run setup-wallet
```

*(Note: If you are building/testing on Base Sepolia, you can append `-- testnet` to this command. The script will automatically call the testnet faucet to fund your agent's wallet with free test ETH and USDC).*

## 💻 Usage Example

To use this tool, your agent needs a wallet capable of signing EIP-712 messages (e.g., using Viem or Coinbase CDP SDK).

```typescript
import { createTagPerTrackTool, createTagPerTrackWithLyricsTool } from 'tag-per-track-agentkit';
import { cdpWallet } from './your-cdp-config'; // Custom CDP or Viem setup

// 1. Initialize your agent's tool
const tagPerTrackTool = createTagPerTrackTool(cdpWallet);
const lyricsTool = createTagPerTrackWithLyricsTool(cdpWallet);

// 2. Add to LangChain Agent tools array
const tools = [tagPerTrackTool, lyricsTool, ...otherTools];

// 3. The Agent can now analyze music from local files or URLs!
// Example A: Local audio file (e.g. downloaded recording or attachment)
const localResult = await tagPerTrackTool.invoke({
  filePath: "./music/my_recording.mp3"
});

// Example B: Remote URL with full vocal lyrics extraction (0.10 USDC)
const urlResult = await lyricsTool.invoke({
  fileUrl: "https://example.com/song.mp3"
});
```

### Tool Parameters

- `filePath` (*string, optional*): Path to a local audio file on disk (`.mp3`, `.wav`, `.ogg`, `.flac`). Use this whenever analyzing a local file, recording, or email attachment saved locally. The file will be read in binary and streamed via `multipart/form-data`.
- `fileUrl` (*string, optional*): The direct publicly accessible URL (HTTP/HTTPS or IPFS) of the audio file to analyze.
- `extractLyrics` (*boolean, optional*): Set to `true` to transcribe and extract vocal lyrics in addition to metadata. Costs 0.10 USDC instead of 0.05 USDC.

## ⚡ How it Works (The x402 Cycle)

1. **Pre-Validation**: The tool validates the file locally (size < 50MB, file exists) before initiating any network request.
2. **Initial Call**: The agent sends a lightweight request to obtain payment instructions. The API returns `HTTP 402 Payment Required`.
3. **Challenge Extraction**: The `TagPerTrackTool` parses the `PAYMENT-REQUIRED` header or body (`amount`, `asset`, `payTo`).
4. **EIP-3009 Signing**: The agent signs a `TransferWithAuthorization` EIP-712 message using its wallet.
5. **Resubmission**: The tool sends the final request with the `PAYMENT-SIGNATURE` header. For local files, the binary data is transmitted via `FormData` (`multipart/form-data`).
6. **Verification & Execution**: The backend verifies the signature on-chain, settles the payment, and triggers the audio analysis.

## 📁 Project Structure

```
tag-per-track-agentkit/
├── src/
│   ├── TagPerTrackTool.ts        # Main LangChain tool (x402 payment cycle & binary upload)
│   ├── TagPerTrackTool.spec.ts   # Unit test suite
│   ├── builderCode.ts            # On-chain attribution utilities (ERC-8021)
│   ├── test-connector.ts         # End-to-end test script
│   └── setup-wallet.ts           # Wallet provisioning script
├── .env.example                  # Environment variable template
├── package.json
└── tsconfig.json
```

## 🛠 Scripts

- `npm test` — Runs the unit test suite verifying path resolution, MIME detection, and tool schemas.
- `npm run test:connector` — Runs an end-to-end test with a default public audio URL.
  - Test a local audio file: `npm run test:connector -- ./my-track.mp3`
  - Test with lyrics extraction: `npm run test:connector -- ./my-track.mp3 --lyrics`
  - Test a custom remote URL: `npm run test:connector -- https://example.com/song.mp3`
- `npm run setup-wallet` — Provisions the agent's wallet on Base Mainnet (use `-- testnet` for Sepolia).
- `npm run build` — Compiles the TypeScript code to `dist/`.
- `npm run clean` — Removes the `dist/` output directory.

## API Documentation & Under the Hood

This SDK is a wrapper around the core Tag-per-Track API.
If you want to explore the underlying REST endpoints, inspect the precise JSON schemas returned by our Essentia/TensorFlow models, or test the inference manually, check out our interactive Swagger UI:

👉 **[Tag-per-Track API Swagger Documentation](https://api.tag-per-track.cloud/api/docs)**

---

Built for the **Agentic Commerce** era. 🚀
