# Tag-per-Track AgentKit Tool 🎸🤖

An **Agentic-First** LangChain/AgentKit tool designed to enable AI Agents to perform advanced audio analysis and artist qualification while handling on-chain micro-payments autonomously via the **x402 protocol** (HTTP 402 Payment Required).

## 🌟 Overview

Tag-per-Track equips AI agents with four specialized tools:
1. **`analyze_music_track`**: Analyzes a local audio file or remote URL to extract musical metadata (**BPM, Key, Scale, Duration, Genres, Moods, Instruments**) AND **AI Origin Integrity** (`ai_detection`: Suno, Udio, neural vocoders) with an autonomous micro-payment (0.15 USDC on Base).
2. **`analyze_music_track_with_lyrics`**: Extracts all musical metadata, transcribes vocal lyrics using AI speech-to-text, and verifies AI origin integrity (0.25 USDC on Base).
3. **`analyze_audio_batch`**: Analyzes multiple tracks in parallel with bounded concurrency (1-5, default 4), track-by-track error isolation, and AI origin detection on every track.
4. **`lookup_artist_stats`**: Retrieves public Spotify traction metrics (**Monthly Listeners, Followers, Popularity Score, Genres**) for A&R qualification and talent scouting (**Free**, no x402 payment required).

The agent handles payments itself using a **Server-Managed Coinbase CDP Wallet** or local private key, signing an **EIP-3009 TransferWithAuthorization** (EIP-712) without any human intervention.

## 🚀 Key Features

- **Standardized Payment**: Implements the x402 standard for frictionless monetized APIs.
- **AI Origin Integrity Detection**: Automatically detects AI-generated tracks (Suno, Udio, neural vocoders) returning clear verdicts (`HUMAN`, `AI_GENERATED`, `UNCERTAIN`) to safeguard autonomous agents from signing or licensing copyright-compromised material.
- **Local Binary Files & Remote URLs**: Supports local audio files (`filePath`) uploaded via `multipart/form-data` as well as remote URLs (`fileUrl`).
- **Automatic Audio Compression**: Files larger than 15 MB or uncompressed PCM formats (`.wav`, `.aiff`) are automatically compressed to 128k AAC/M4A via native macOS `afconvert` or `ffmpeg` to reduce transfer latency and prevent memory exhaustion.
- **Financial Spending Guard**: Configurable spending cap via `MAX_SPENDING_USDC` (default: 0.50 USDC) or tool options to protect agent funds from unexpected invoices.
- **Reduced EIP-3009 Window**: Authorization validity capped at 5 minutes (300s) to guard against replay attacks.
- **Pre-Payment Safety Validation**: Validates file existence, format whitelist (`.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`, `.aac`, `.aiff`), and size limit (50 MB) **before** initiating or signing x402 payments.
- **Batch Processing**: Parallel execution with controlled concurrency to drastically reduce total processing time.
- **A&R Artist Qualification**: Instant lookup of Spotify commercial traction metrics.
- **Coinbase CDP Integrated**: Native support for Coinbase SDK Managed Wallets and Viem.

## 🛠 Prerequisites

- **Base Mainnet / Base Sepolia**: The tool runs on Base (Mainnet or Sepolia).
- **USDC**: Ensure your agent's wallet has USDC on the selected network.
- **Coinbase CDP API Keys**: You need `CDP_API_KEY_NAME` and `CDP_API_KEY_PRIVATE_KEY` (or a local private key).

## 📦 Setup

### 1. Installation

```bash
npm install tag-per-track-agentkit
```

### 2. Environment Variables

Create a `.env.local` file at the project root:

```env
# Coinbase CDP Credentials (from your project dashboard)
CDP_API_KEY_NAME="organizations/..."
CDP_API_KEY_PRIVATE_KEY="-----BEGIN ANY KEY-----..."

# The Seed for your agent's persistent wallet (keep this safe!)
CDP_WALLET_SECRET="your-cdp-shared-secret"

# Optional: Local Private Key fallback (alternative to CDP)
# PRIVATE_KEY="0x..."

# Optional: Maximum spending cap in USDC per transaction (default: 0.50)
# MAX_SPENDING_USDC=0.50
```

### 3. Wallet Setup (Provisioning)

If it's your agent's first time, run the setup script to create the wallet. Once created, send some ETH (for gas) and USDC (for payments) to the generated address on Base Mainnet:

```bash
npm run setup-wallet
```

*(Note: On Base Sepolia, append `-- testnet` to automatically call the testnet faucet for free test ETH and USDC).*

## 💻 Usage Example

```typescript
import {
  createTagPerTrackTool,
  createTagPerTrackWithLyricsTool,
  createTagPerTrackBatchTool,
  createLookupArtistStatsTool,
} from 'tag-per-track-agentkit';
import { cdpWallet } from './your-cdp-config'; // Custom CDP or Viem setup

// 1. Initialize tools
const tagTool = createTagPerTrackTool(cdpWallet);
const lyricsTool = createTagPerTrackWithLyricsTool(cdpWallet);
const batchTool = createTagPerTrackBatchTool(cdpWallet);
const artistStatsTool = createLookupArtistStatsTool(); // Free, no wallet needed!

// 2. Add to your LangChain / AgentKit agent tools array
const tools = [tagTool, lyricsTool, batchTool, artistStatsTool];

// --- Example A: Single Local Audio File (0.15 USDC) ---
const trackResult = await tagTool.invoke({
  filePath: "./music/demo_track.wav", // Automatically compressed if >15MB
});

// --- Example B: Remote URL with Lyrics Extraction (0.25 USDC) ---
const lyricsResult = await lyricsTool.invoke({
  fileUrl: "https://example.com/vocal_song.mp3",
});

// --- Example C: Batch Analysis of Multiple Tracks ---
const batchResult = await batchTool.invoke({
  filePaths: ["./tracks/track1.mp3", "./tracks/track2.wav"],
  concurrency: 4,
});

// --- Example D: Artist Streaming Metrics (Free) ---
const artistMetrics = await artistStatsTool.invoke({
  artist_name: "Daft Punk",
});
```

## 🛠 Tool Reference

### 1. `analyze_music_track`
- **Pricing**: 0.15 USDC on Base via x402.
- **Parameters**:
  - `filePath` (*string, optional*): Path to a local audio file on disk (`.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`, `.aac`, `.aiff`).
  - `fileUrl` (*string, optional*): Direct publicly accessible URL of the audio file.
  - `extractLyrics` (*boolean, optional*): Set to `true` to also transcribe lyrics (0.25 USDC).
- **Returns**: Musical attributes (`bpm`, `key`, `scale`, `genres`, `moods`, `instruments`, `duration`) and Origin Integrity report (`ai_detection`: `checked`, `isAi`, `confidence`, `verdict: 'HUMAN' | 'AI_GENERATED' | 'UNCERTAIN'`, `sampleDurationSec: 12`).

### 2. `analyze_music_track_with_lyrics`
- **Pricing**: 0.25 USDC on Base via x402.
- **Parameters**: `filePath` (*string*), `fileUrl` (*string*).
- **Returns**: Full musical metadata, transcribed lyrics (`lyrics`), and AI Origin Integrity report (`ai_detection`).

### 3. `analyze_audio_batch`
- **Pricing**: 0.15 or 0.25 USDC per track on Base via x402.
- **Parameters**:
  - `tracks` (*array of objects, optional*): `[{ filePath, fileUrl, extractLyrics }]`
  - `filePaths` (*string[], optional*): List of local audio file paths.
  - `fileUrls` (*string[], optional*): List of remote audio URLs.
  - `extractLyrics` (*boolean, optional*): Global flag for all tracks.
  - `concurrency` (*number, optional*): Max simultaneous requests (1 to 5, default: 4).

### 4. `lookup_artist_stats`
- **Pricing**: **Free** (no x402 payment required).
- **Parameters**:
  - `artist_name` (*string, required*): Stage name of the artist (e.g., `"Daft Punk"`).
  - `social_links` (*string[], optional*): Social links for context.
- **Returns**: Spotify monthly listeners, followers, popularity score (0-100), genres, and Spotify URL.

## ⚡ How it Works (The x402 Flow)

1. **Pre-Validation**: Validates file extension, regular file status, and size (<50MB) locally.
2. **Selective Compression**: If the audio file is >15MB or uncompressed (`.wav`, `.aiff`), it is compressed to 128k AAC/M4A before uploading.
3. **402 Challenge**: Sends an initial request. The API returns `HTTP 402 Payment Required` with invoice terms.
4. **Spending Cap Guard**: Validates requested amount against `MAX_SPENDING_USDC` (default: 0.50 USDC).
5. **EIP-3009 Signature**: Signs a gasless `TransferWithAuthorization` EIP-712 message (valid for 5 minutes).
6. **Payment Proof & Execution**: Transmits the request with `PAYMENT-SIGNATURE`. For local files, binary data is read and sent via `multipart/form-data`.
7. **Settlement**: The backend settles payment on Base Mainnet and returns the analysis metadata.

## 📁 Project Structure

```
tag-per-track-agentkit/
├── src/
│   ├── index.ts                  # Main SDK entry point (re-exports tools & types)
│   ├── TagPerTrackTool.ts        # LangChain tools (x402 payment cycle, compression & batch)
│   ├── TagPerTrackTool.spec.ts   # Comprehensive unit test suite
│   ├── test-connector.ts         # CLI test harness (single, batch, artist stats)
│   └── setup-wallet.ts           # Wallet provisioning script
├── .env.example                  # Environment variable template
├── package.json
└── tsconfig.json
```

## 🛠 Scripts

- `npm test` — Runs the unit test suite verifying path resolution, MIME detection, compression, schemas, and guardrails.
- `npm run test:connector -- [args]` — CLI test harness:
  - Single track: `npm run test:connector -- ./track.mp3`
  - With lyrics: `npm run test:connector -- ./track.mp3 --lyrics`
  - Artist stats: `npm run test:connector -- --artist "Daft Punk"`
  - Batch analysis: `npm run test:connector -- --batch ./track1.mp3 ./track2.mp3`
- `npm run setup-wallet` — Provisions the agent's wallet on Base Mainnet (use `-- testnet` for Sepolia).
- `npm run build` — Compiles TypeScript to `dist/`.
- `npm run clean` — Removes the `dist/` build directory.

## API Documentation & Interactive Swagger

Explore the underlying REST endpoints, test inference manually, or inspect JSON schemas:

👉 **[Tag-per-Track API Swagger Documentation](https://api.tag-per-track.cloud/api/docs)**

---

Built for the **Agentic Commerce** era. 🚀
