import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getBuilderCodeDataSuffix, DEFAULT_BUILDER_CODE } from "./builderCode";

// Re-export builder code utilities for consumers
export { getBuilderCodeDataSuffix, getBuilderCodeFromEnv, DEFAULT_BUILDER_CODE } from "./builderCode";

export interface AudioInput {
    fileUrl?: string;
    filePath?: string;
    extractLyrics?: boolean;
}

export const MAX_LOCAL_FILE_SIZE = 50 * 1024 * 1024; // 50 MB limit

/**
 * Resolves a local path, expanding '~', file:// URLs, and relative paths.
 */
export function resolveLocalPath(filePath: string): string {
    if (filePath.startsWith('file://')) {
        try {
            return fileURLToPath(filePath);
        } catch {
            return filePath.replace(/^file:\/\//, '');
        }
    }
    if (filePath.startsWith('~')) {
        return path.resolve(os.homedir(), filePath.slice(1).replace(/^[/\\]/, ''));
    }
    return path.resolve(process.cwd(), filePath);
}

/**
 * Detects if a string is intended as a local file path rather than a remote URL.
 */
export function isLikelyLocalPath(str: string): boolean {
    if (!str || typeof str !== 'string') return false;
    const trimmed = str.trim();
    return (
        trimmed.startsWith('file://') ||
        trimmed.startsWith('~') ||
        trimmed.startsWith('/') ||
        trimmed.startsWith('./') ||
        trimmed.startsWith('../') ||
        /^[a-zA-Z]:[\\/]/.test(trimmed)
    );
}

/**
 * Maps common audio file extensions to their standard MIME type.
 */
export function getAudioMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
        case '.mp3':
            return 'audio/mpeg';
        case '.wav':
            return 'audio/wav';
        case '.ogg':
            return 'audio/ogg';
        case '.flac':
            return 'audio/flac';
        case '.m4a':
            return 'audio/mp4';
        case '.aac':
            return 'audio/aac';
        case '.aiff':
        case '.aif':
            return 'audio/aiff';
        default:
            return 'application/octet-stream';
    }
}

/**
 * Abstract interface for the agent's wallet.
 * Supports EIP-712 signing for the x402 protocol.
 */
export interface AgentWallet {
    address: `0x${string}`;
    signTypedData: (data: {
        domain: any;
        types: any;
        primaryType: string;
        message: any;
    }) => Promise<string>;
}

/**
 * Options for configuring the Tag-per-Track tool.
 */
export interface TagPerTrackToolOptions {
    /** The endpoint of the Tag-per-Track API. */
    apiUrl?: string;
    /** Your Base Builder Code for on-chain attribution (e.g. "bc_xxxxxxxx"). */
    builderCode?: string;
}

/**
 * Creates a LangChain tool for the Tag-per-Track audio analysis service.
 * This tool manages the full x402 payment challenge-response cycle.
 * Supports both local binary audio files via 'filePath' and remote URLs via 'fileUrl'.
 * 
 * @param agentWallet The wallet used to sign the x402 payment proof.
 * @param options Optional configuration (API URL, Builder Code).
 * @returns A DynamicStructuredTool ready to be used by an AI Agent.
 */
export const createTagPerTrackTool = (
    agentWallet: AgentWallet,
    options: TagPerTrackToolOptions | string = {}
) => {
    // Backwards compatibility: accept a string as apiUrl
    const opts: TagPerTrackToolOptions = typeof options === 'string'
        ? { apiUrl: options }
        : options;

    const apiUrl = opts.apiUrl || "https://api.tag-per-track.cloud/api/analyze";

    // Generate ERC-8021 dataSuffix — defaults to Tag-per-Track builder code
    const builderCode = opts.builderCode || process.env.BUILDER_CODE || DEFAULT_BUILDER_CODE;
    const dataSuffix = getBuilderCodeDataSuffix([builderCode]);

    if (dataSuffix) {
        console.log(`[🏗️  BuilderCode] Attribution enabled: ${builderCode}`);
    }

    return new DynamicStructuredTool({
        name: "analyze_music_track",
        description:
            "Analyzes a music track or audio file to extract musical metadata (BPM, genre, mood, key, instruments) and optionally vocal lyrics. " +
            "Supports local audio files via 'filePath' (read in binary and uploaded) or remote URLs via 'fileUrl'. " +
            "Note: This tool automatically executes a micro-payment (0.05 USDC for standard analysis, or 0.10 USDC when extractLyrics is enabled) via the x402 protocol on Base " +
            "using the agent's wallet signature.",

        schema: z.object({
            filePath: z.string()
                .optional()
                .describe("Path to a local audio file on disk (.mp3, .wav, .ogg, .flac). Use this whenever analyzing a local file, recording, or email attachment saved locally."),
            fileUrl: z.string()
                .optional()
                .describe("The direct publicly accessible URL (HTTP/HTTPS or IPFS) of the audio file to analyze."),
            extractLyrics: z.boolean()
                .optional()
                .describe("Optional: Set to true to transcribe and extract song lyrics in addition to metadata. Costs 0.10 USDC instead of 0.05 USDC."),
        }),

        func: async ({ filePath: inputFilePath, fileUrl: inputFileUrl, extractLyrics }) => {
            try {
                let filePath = inputFilePath ? inputFilePath.trim() : undefined;
                let fileUrl = inputFileUrl ? inputFileUrl.trim() : undefined;

                // If both are provided, prioritize the local file
                if (filePath && fileUrl) {
                    console.log(`[🤖 TagPerTrackTool] Both 'filePath' and 'fileUrl' provided. Prioritizing local file: "${filePath}".`);
                    fileUrl = undefined;
                }

                // Auto-detect if fileUrl is actually a local file or file:// URL
                if (!filePath && fileUrl) {
                    if (isLikelyLocalPath(fileUrl)) {
                        const potentialLocalPath = resolveLocalPath(fileUrl);
                        if (fs.existsSync(potentialLocalPath)) {
                            console.log(`[🤖 TagPerTrackTool] Detected local file in 'fileUrl' ("${fileUrl}"). Auto-converting to local upload.`);
                            filePath = potentialLocalPath;
                            fileUrl = undefined;
                        } else {
                            return `Invalid fileUrl "${fileUrl}": local or relative filesystem paths cannot be fetched by the remote server. ` +
                                `The file was also not found locally at "${potentialLocalPath}". Please provide an existing local file via 'filePath' or a valid public HTTP/IPFS URL via 'fileUrl'.`;
                        }
                    }
                }

                if (!filePath && !fileUrl) {
                    return "Missing audio source: Please provide either 'filePath' (for a local audio file on disk) or 'fileUrl' (for a public HTTP/HTTPS or IPFS URL).";
                }

                let localFileData: { buffer: Buffer; filename: string; mimeType: string } | undefined;

                if (filePath) {
                    const resolvedPath = resolveLocalPath(filePath);
                    if (!fs.existsSync(resolvedPath)) {
                        return `Local file not found: "${filePath}" (resolved path: "${resolvedPath}"). Please verify the path.`;
                    }
                    const stat = await fs.promises.stat(resolvedPath);
                    if (!stat.isFile()) {
                        return `The provided path is not a regular file: "${filePath}"`;
                    }
                    if (stat.size > MAX_LOCAL_FILE_SIZE) {
                        return `File is too large (${(stat.size / 1024 / 1024).toFixed(2)} MB). Maximum allowed size is 50MB.`;
                    }
                    const buffer = await fs.promises.readFile(resolvedPath);
                    const filename = path.basename(resolvedPath);
                    const mimeType = getAudioMimeType(filename);
                    localFileData = { buffer, filename, mimeType };
                }

                const targetUrl = extractLyrics
                    ? (apiUrl.endsWith('/analyze') ? `${apiUrl}-with-lyrics` : `${apiUrl.replace(/\/analyze$/, '')}/analyze-with-lyrics`)
                    : apiUrl;

                const sourceDescription = localFileData
                    ? `local file: ${localFileData.filename} (${(localFileData.buffer.length / 1024 / 1024).toFixed(2)} MB)`
                    : `remote URL: ${fileUrl}`;

                console.log(`[🤖 TagPerTrackTool] Starting analysis for ${sourceDescription} (extractLyrics: ${Boolean(extractLyrics)})`);
                console.log(`[🤖 TagPerTrackTool] Target endpoint: ${targetUrl}`);

                // 1. Initial Request (Triggers 402 Payment Required)
                const triggerBody = fileUrl ? { fileUrl } : { fileName: localFileData?.filename };
                const initialResponse = await fetch(targetUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(triggerBody)
                });

                if (initialResponse.status === 400) {
                    const error = await initialResponse.json();
                    return `Request failed: ${error.message}`;
                }

                if (initialResponse.status !== 402) {
                    throw new Error(`Expected HTTP 402, but received ${initialResponse.status}`);
                }

                // 2. Extract x402 Payment Requirements
                const paymentRequiredHeader = initialResponse.headers.get("PAYMENT-REQUIRED");
                let requirements;
                
                if (paymentRequiredHeader) {
                    // Node.js / Browser compatible base64 decoding
                    const decoded = typeof atob !== 'undefined' 
                        ? atob(paymentRequiredHeader) 
                        : Buffer.from(paymentRequiredHeader, 'base64').toString('utf-8');
                    requirements = JSON.parse(decoded);
                } else {
                    // Fallback to body for backwards compatibility
                    const errorData = await initialResponse.json();
                    requirements = errorData.paymentRequirements;
                }

                if (!requirements) {
                    throw new Error("Missing 'paymentRequirements' in the 402 response.");
                }

                // Handle x402 v2 structure where payment terms are in 'accepts' array
                const accept = requirements.accepts ? requirements.accepts[0] : requirements;

                if (!accept) {
                    throw new Error("Missing 'accepts' payment conditions in the 402 response.");
                }

                console.log(`[🤖 TagPerTrackTool] 402 Received (${accept.amount} units / ${accept.network}). Preparing EIP-3009 signature for payment...`);

                // 3. Construct EIP-3009 Message (TransferWithAuthorization)
                const randomBytes = crypto.getRandomValues(new Uint8Array(32));
                const nonce = `0x${Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
                const validBefore = Math.floor(Date.now() / 1000) + 3600; // expires in 1 hour

                // Determine chain ID from network requirement
                const chainId = accept.network.includes(':')
                    ? parseInt(accept.network.split(':')[1], 10)
                    : (accept.network === 'base-sepolia' ? 84532 : 8453);

                const domain = {
                    name: accept.extra?.name || (accept.network.includes('sepolia') || accept.network.includes('84532') ? 'USDC' : 'USD Coin'),
                    version: accept.extra?.version || '2',
                    chainId: chainId,
                    verifyingContract: accept.asset,
                };

                const types = {
                    EIP712Domain: [
                        { name: 'name', type: 'string' },
                        { name: 'version', type: 'string' },
                        { name: 'chainId', type: 'uint256' },
                        { name: 'verifyingContract', type: 'address' },
                    ],
                    TransferWithAuthorization: [
                        { name: 'from', type: 'address' },
                        { name: 'to', type: 'address' },
                        { name: 'value', type: 'uint256' },
                        { name: 'validAfter', type: 'uint256' },
                        { name: 'validBefore', type: 'uint256' },
                        { name: 'nonce', type: 'bytes32' },
                    ],
                };

                const message = {
                    from: agentWallet.address,
                    to: accept.payTo,
                    value: BigInt(accept.amount || accept.maxAmountRequired),
                    validAfter: BigInt(0),
                    validBefore: BigInt(validBefore),
                    nonce: nonce as `0x${string}`,
                };

                // 4. Sign the Authorization Message
                const signature = await agentWallet.signTypedData({
                    domain,
                    types,
                    primaryType: 'TransferWithAuthorization',
                    message,
                });

                // 5. Construct Payment Proof (x402 V2 structure aligned with standard)
                const paymentProof = JSON.stringify({
                    x402Version: 2,
                    accepted: accept,
                    payload: {
                        signature,
                        authorization: {
                            from: message.from,
                            to: message.to,
                            value: message.value.toString(),
                            validAfter: message.validAfter.toString(),
                            validBefore: message.validBefore.toString(),
                            nonce: message.nonce,
                        },
                    },
                    resource: requirements.resource || {
                        url: targetUrl,
                        description: extractLyrics
                            ? 'Tag-per-Track: Agentic-First Musical Audio Analysis API. Extracts BPM, Key, Mood, Genres, Instruments AND Lyrics from audio.'
                            : 'Tag-per-Track: Agentic-First Musical Audio Analysis API. Extracts BPM, Key, Mood, Genres and Instruments from audio.',
                        mimeType: 'application/json',
                    },
                    extensions: requirements.extensions
                });

                console.log(`[🤖 TagPerTrackTool] Proof generated and signed. Re-submitting request to ${targetUrl}...`);

                // 6. Secondary Call with PAYMENT-SIGNATURE header
                const headers: Record<string, string> = {
                    'PAYMENT-SIGNATURE': paymentProof,
                    'X-Payment-Proof': paymentProof // Kept for backwards compatibility
                };

                let body: BodyInit;
                if (localFileData) {
                    const formData = new FormData();
                    const blob = new Blob([new Uint8Array(localFileData.buffer)], { type: localFileData.mimeType });
                    formData.append('file', blob, localFileData.filename);
                    body = formData;
                } else {
                    headers['Content-Type'] = 'application/json';
                    body = JSON.stringify({ fileUrl });
                }

                const finalResponse = await fetch(targetUrl, {
                    method: 'POST',
                    headers,
                    body
                });

                if (!finalResponse.ok) {
                    const error = await finalResponse.json();
                    console.error("Detailed backend error:", JSON.stringify(error, null, 2));
                    throw new Error(error.message || `Analysis failed after payment (HTTP ${finalResponse.status}).`);
                }

                const result = await finalResponse.json();
                console.log(`[🤖 TagPerTrackTool] Analysis completed successfully.`);

                return JSON.stringify(result.data, null, 2);

            } catch (error: any) {
                console.error(`[🤖 TagPerTrackTool] Analysis Error:`, error.message);
                return `Error analyzing track: ${error.message}. Ensure your wallet has sufficient USDC on the correct network.`;
            }
        }
    });
};

/**
 * Creates a LangChain tool specifically configured for extracting both metadata AND lyrics.
 * Supports local audio files via 'filePath' (read in binary and uploaded) or remote URLs via 'fileUrl'.
 * 
 * @param agentWallet The wallet used to sign the x402 payment proof.
 * @param options Optional configuration (API URL, Builder Code).
 * @returns A DynamicStructuredTool configured for lyrics extraction (0.10 USDC).
 */
export const createTagPerTrackWithLyricsTool = (
    agentWallet: AgentWallet,
    options: TagPerTrackToolOptions | string = {}
) => {
    const baseTool = createTagPerTrackTool(agentWallet, options);

    return new DynamicStructuredTool({
        name: "analyze_music_track_with_lyrics",
        description:
            "Analyzes an audio track or music file to extract complete musical metadata (BPM, genre, mood, key, instruments) AND transcribe full vocal lyrics using AI. " +
            "Supports local audio files via 'filePath' (read in binary and uploaded) or remote URLs via 'fileUrl'. " +
            "Note: This tool automatically executes a micro-payment of 0.10 USDC via the x402 protocol on Base " +
            "using the agent's wallet signature.",

        schema: z.object({
            filePath: z.string()
                .optional()
                .describe("Path to a local audio file on disk (.mp3, .wav, .ogg, .flac). Use this whenever analyzing a local file, recording, or email attachment saved locally."),
            fileUrl: z.string()
                .optional()
                .describe("The direct publicly accessible URL (HTTP/HTTPS or IPFS) of the audio file to analyze."),
        }),

        func: async ({ filePath, fileUrl }) => {
            return await baseTool.invoke({ filePath, fileUrl, extractLyrics: true });
        }
    });
};