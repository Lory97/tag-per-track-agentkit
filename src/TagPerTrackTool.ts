import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getBuilderCodeDataSuffix, DEFAULT_BUILDER_CODE } from "./builderCode";

const execFileAsync = promisify(execFile);

// Re-export builder code utilities for consumers
export { getBuilderCodeDataSuffix, getBuilderCodeFromEnv, DEFAULT_BUILDER_CODE } from "./builderCode";

export interface AudioInput {
    fileUrl?: string;
    filePath?: string;
    extractLyrics?: boolean;
}

export interface Prediction {
    label: string;
    score?: number;
    confidence?: number;
}

export interface AiDetectionResult {
    checked: boolean;
    isAi: boolean;
    confidence: number;
    verdict: 'HUMAN' | 'AI_GENERATED' | 'UNCERTAIN';
    status?: string;
}

export interface AudioAnalysisResult {
    bpm?: number;
    key?: string;
    scale?: string;
    duration?: number;
    genres?: Array<Prediction> | string[];
    moods?: Array<Prediction> | string[];
    instruments?: Array<Prediction> | string[];
    lyrics?: string;
    aiDetection?: AiDetectionResult;
    ai_detection?: AiDetectionResult;
    [key: string]: any;
}

export interface SpotifyArtistMetrics {
    id: string;
    followers: number;
    popularity: number;
    monthlyListeners?: number;
    genres: string[];
    url: string;
}

export interface ArtistStatsResponse {
    name: string;
    spotify: SpotifyArtistMetrics;
    cached: boolean;
    social_links?: string[];
}

export interface BatchTrackItem {
    filePath?: string;
    fileUrl?: string;
    extractLyrics?: boolean;
}

export interface BatchTrackResult {
    track: string;
    filePath?: string;
    fileUrl?: string;
    extractLyrics: boolean;
    status: 'success' | 'error';
    data?: AudioAnalysisResult;
    error?: string;
}

export interface BatchAnalysisResponse {
    totalTracks: number;
    successful: number;
    failed: number;
    concurrency: number;
    results: BatchTrackResult[];
}

export interface CompressionResult {
    resolvedPath: string;
    filename: string;
    mimeType: string;
    size: number;
    cleanup: () => Promise<void>;
}

export const MAX_LOCAL_FILE_SIZE = 50 * 1024 * 1024; // 50 MB limit
export const COMPRESSION_SIZE_THRESHOLD = 15 * 1024 * 1024; // 15 MB
export const UNCOMPRESSED_AUDIO_EXTENSIONS = new Set(['.wav', '.aiff', '.aif']);

// Default max spending limit: 0.50 USDC (USDC uses 6 decimals on Base: 500,000 units = 0.50 USDC)
export const DEFAULT_MAX_SPENDING_USDC = 500_000n;

// EIP-3009 authorization valid for 5 minutes (300 seconds)
export const EIP3009_VALIDITY_SECONDS = 300;

export const SUPPORTED_AUDIO_MIME_TYPES: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.aiff': 'audio/aiff',
    '.aif': 'audio/aiff',
};

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
 * Validates audio file extension against strict whitelist and returns its MIME type.
 * Rejects non-audio files immediately to prevent arbitrary file exfiltration.
 */
export function getAudioMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeType = SUPPORTED_AUDIO_MIME_TYPES[ext];
    if (!mimeType) {
        throw new Error(
            `Unsupported file format "${ext || 'none'}". ` +
            `Only audio files (${Object.keys(SUPPORTED_AUDIO_MIME_TYPES).join(', ')}) are accepted.`
        );
    }
    return mimeType;
}

/**
 * Checks whether an audio file should be compressed prior to upload.
 * Only uncompressed PCM formats or files larger than 15 MB are compressed.
 */
export function shouldCompressAudio(filename: string, size: number): boolean {
    const ext = path.extname(filename).toLowerCase();
    if (UNCOMPRESSED_AUDIO_EXTENSIONS.has(ext)) {
        return true;
    }
    return size > COMPRESSION_SIZE_THRESHOLD;
}

/**
 * Compresses an audio file to AAC/M4A if it is heavy or uncompressed.
 * Uses native macOS /usr/bin/afconvert when available, or ffmpeg as fallback.
 * Gracefully falls back to original file if compression tools are unavailable.
 */
export async function compressAudioIfHeavy(
    originalPath: string,
    originalFilename: string,
    originalMime: string,
    originalSize: number
): Promise<CompressionResult> {
    const noopCleanup = async () => {};

    if (!shouldCompressAudio(originalFilename, originalSize)) {
        return {
            resolvedPath: originalPath,
            filename: originalFilename,
            mimeType: originalMime,
            size: originalSize,
            cleanup: noopCleanup
        };
    }

    const baseNameWithoutExt = path.basename(originalFilename, path.extname(originalFilename));
    const tempCompressedFilename = `tpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`;
    const tempOutputPath = path.join(os.tmpdir(), tempCompressedFilename);

    const cleanup = async () => {
        try {
            await fs.promises.unlink(tempOutputPath);
        } catch {
            // Ignore if file doesn't exist
        }
    };

    console.log(`[🤖 TagPerTrackTool] Compressing heavy/uncompressed file (${(originalSize / 1024 / 1024).toFixed(2)} MB): "${originalFilename}" -> AAC/M4A...`);

    try {
        if (process.platform === 'darwin' && fs.existsSync('/usr/bin/afconvert')) {
            await execFileAsync('/usr/bin/afconvert', [
                '-f', 'm4af',
                '-d', 'aac',
                '-b', '128000',
                originalPath,
                tempOutputPath
            ]);
        } else {
            await execFileAsync('ffmpeg', [
                '-y',
                '-i', originalPath,
                '-c:a', 'aac',
                '-b:a', '128k',
                tempOutputPath
            ]);
        }

        const stat = await fs.promises.stat(tempOutputPath);
        if (stat.size > 0 && stat.size < originalSize) {
            console.log(
                `[🤖 TagPerTrackTool] Compression successful: ${(originalSize / 1024 / 1024).toFixed(2)} MB -> ${(stat.size / 1024 / 1024).toFixed(2)} MB ` +
                `(-${Math.round((1 - stat.size / originalSize) * 100)}%).`
            );
            return {
                resolvedPath: tempOutputPath,
                filename: `${baseNameWithoutExt}.m4a`,
                mimeType: 'audio/mp4',
                size: stat.size,
                cleanup
            };
        } else {
            console.log(`[🤖 TagPerTrackTool] Compressed file not significantly smaller (${stat.size} vs ${originalSize} bytes). Keeping original.`);
            await cleanup();
            return {
                resolvedPath: originalPath,
                filename: originalFilename,
                mimeType: originalMime,
                size: originalSize,
                cleanup: noopCleanup
            };
        }
    } catch (compressionErr: any) {
        console.log(`[🤖 TagPerTrackTool] Audio compression skipped / fallback (${compressionErr.message}). Keeping original file.`);
        await cleanup();
        return {
            resolvedPath: originalPath,
            filename: originalFilename,
            mimeType: originalMime,
            size: originalSize,
            cleanup: noopCleanup
        };
    }
}

/**
 * Reads the configured maximum spending limit or defaults to 0.20 USDC.
 */
export function getMaxSpendingCap(customCap?: number): bigint {
    if (customCap !== undefined && customCap > 0) {
        return BigInt(Math.round(customCap * 1_000_000));
    }
    if (process.env.MAX_SPENDING_USDC) {
        const parsed = parseFloat(process.env.MAX_SPENDING_USDC);
        if (!isNaN(parsed) && parsed > 0) {
            return BigInt(Math.round(parsed * 1_000_000));
        }
    }
    return DEFAULT_MAX_SPENDING_USDC;
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
    /** The endpoint of the Tag-per-Track API. Default: "https://api.tag-per-track.cloud/api/analyze" */
    apiUrl?: string;
    /** The base URL of the Tag-per-Track API. Default: "https://api.tag-per-track.cloud/api" */
    apiBaseUrl?: string;
    /** Your Base Builder Code for on-chain attribution (e.g. "bc_xxxxxxxx"). */
    builderCode?: string;
    /** Maximum spending limit in USDC per call (e.g. 0.50). Overrides MAX_SPENDING_USDC. */
    maxSpendingUsdc?: number;
}

/**
 * Options for configuring the Artist Stats tool.
 */
export interface LookupArtistStatsToolOptions {
    /** The base URL of the Tag-per-Track API. Default: "https://api.tag-per-track.cloud/api" */
    apiBaseUrl?: string;
}

/**
 * Executes the core x402 audio analysis request for a single track.
 */
export async function executeAnalyzeAudio(
    input: AudioInput,
    agentWallet: AgentWallet,
    options: TagPerTrackToolOptions = {}
): Promise<AudioAnalysisResult> {
    const apiUrl = options.apiUrl || "https://api.tag-per-track.cloud/api/analyze";
    let filePath = input.filePath ? input.filePath.trim() : undefined;
    let fileUrl = input.fileUrl ? input.fileUrl.trim() : undefined;
    const extractLyrics = Boolean(input.extractLyrics);

    // If both are provided, prioritize local file
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
                throw new Error(
                    `Invalid fileUrl "${fileUrl}": local or relative filesystem paths cannot be fetched by the remote server. ` +
                    `The file was also not found locally at "${potentialLocalPath}". Please provide an existing local file via 'filePath' or a valid public HTTP/IPFS URL via 'fileUrl'.`
                );
            }
        }
    }

    if (!filePath && !fileUrl) {
        throw new Error("Missing audio source: Please provide either 'filePath' (for a local audio file on disk) or 'fileUrl' (for a public HTTP/HTTPS or IPFS URL).");
    }

    let localFileMeta: { resolvedPath: string; filename: string; mimeType: string; size: number } | undefined;
    let localFileCleanup: (() => Promise<void>) | undefined;

    if (filePath) {
        const resolvedPath = resolveLocalPath(filePath);
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Local file not found: "${filePath}" (resolved path: "${resolvedPath}"). Please verify the path.`);
        }
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isFile()) {
            throw new Error(`The provided path is not a regular file: "${filePath}"`);
        }
        if (stat.size > MAX_LOCAL_FILE_SIZE) {
            throw new Error(`File is too large (${(stat.size / 1024 / 1024).toFixed(2)} MB). Maximum allowed size is 50MB.`);
        }

        const filename = path.basename(resolvedPath);
        const mimeType = getAudioMimeType(filename); // Throws if unsupported extension

        // Selectively compress heavy or uncompressed files
        const compressed = await compressAudioIfHeavy(resolvedPath, filename, mimeType, stat.size);
        localFileMeta = {
            resolvedPath: compressed.resolvedPath,
            filename: compressed.filename,
            mimeType: compressed.mimeType,
            size: compressed.size
        };
        localFileCleanup = compressed.cleanup;
    }

    const targetUrl = extractLyrics
        ? (apiUrl.endsWith('/analyze') ? `${apiUrl}-with-lyrics` : `${apiUrl.replace(/\/analyze$/, '')}/analyze-with-lyrics`)
        : apiUrl;

    const sourceDescription = localFileMeta
        ? `local file: ${localFileMeta.filename} (${(localFileMeta.size / 1024 / 1024).toFixed(2)} MB)`
        : `remote URL: ${fileUrl}`;

    console.log(`[🤖 TagPerTrackTool] Starting analysis for ${sourceDescription} (extractLyrics: ${extractLyrics})`);
    console.log(`[🤖 TagPerTrackTool] Target endpoint: ${targetUrl}`);

    try {
        // 1. Initial Request (Triggers 402 Payment Required) - 15s timeout
        const triggerBody = fileUrl ? { fileUrl } : { fileName: localFileMeta?.filename };
        let initialResponse: Response;

        try {
            initialResponse = await fetch(targetUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(triggerBody),
                signal: AbortSignal.timeout(15_000)
            });
        } catch (networkError: any) {
            if (networkError.name === 'TimeoutError') {
                throw new Error(`Initial connection to ${targetUrl} timed out after 15 seconds. Please check network connectivity.`);
            }
            throw new Error(`Failed to reach Tag-per-Track API: ${networkError.message}`);
        }

        if (initialResponse.status === 400) {
            let errorMsg = 'Bad request';
            try {
                const error = await initialResponse.json();
                errorMsg = error.message || errorMsg;
            } catch {}
            throw new Error(`Request failed (HTTP 400): ${errorMsg}`);
        }

        if (initialResponse.status !== 402) {
            let errorDetail = '';
            try {
                const text = await initialResponse.text();
                if (text) errorDetail = `: ${text.slice(0, 300)}`;
            } catch {}
            throw new Error(`Expected HTTP 402, but received ${initialResponse.status}${errorDetail}`);
        }

        // 2. Extract x402 Payment Requirements
        const paymentRequiredHeader = initialResponse.headers.get("PAYMENT-REQUIRED");
        let requirements: any;

        try {
            if (paymentRequiredHeader) {
                const decoded = typeof atob !== 'undefined'
                    ? atob(paymentRequiredHeader)
                    : Buffer.from(paymentRequiredHeader, 'base64').toString('utf-8');
                requirements = JSON.parse(decoded);
            } else {
                const errorData = await initialResponse.json();
                requirements = errorData.paymentRequirements;
            }
        } catch (parseError: any) {
            throw new Error(`Failed to parse x402 payment requirements from server: ${parseError.message}`);
        }

        if (!requirements) {
            throw new Error("Missing 'paymentRequirements' in the 402 response.");
        }

        // Handle x402 v2 structure where payment terms are in 'accepts' array
        const accept = requirements.accepts ? requirements.accepts[0] : requirements;

        if (!accept || !accept.asset || !accept.payTo) {
            throw new Error("Incomplete payment terms in x402 response (missing asset or payTo address).");
        }

        // 3. Enforce Financial Spending Cap & Security Guards
        const rawAmount = accept.amount || accept.maxAmountRequired;
        if (!rawAmount) {
            throw new Error("Missing payment amount in x402 terms.");
        }

        const requestedAmount = BigInt(rawAmount);
        const maxSpendingCap = getMaxSpendingCap(options.maxSpendingUsdc);

        if (requestedAmount > maxSpendingCap) {
            const requestedUsdc = (Number(requestedAmount) / 1_000_000).toFixed(4);
            const maxUsdc = (Number(maxSpendingCap) / 1_000_000).toFixed(4);
            throw new Error(
                `[Security Guard] Requested payment of ${requestedUsdc} USDC exceeds your maximum spending limit of ${maxUsdc} USDC. ` +
                `Aborting transaction to protect your wallet. You can increase this limit by setting the MAX_SPENDING_USDC environment variable.`
            );
        }

        console.log(`[🤖 TagPerTrackTool] 402 Received (${accept.amount} units / ${accept.network}). Preparing EIP-3009 signature for payment...`);

        // 4. Construct EIP-3009 Message (TransferWithAuthorization)
        const randomBytes = crypto.getRandomValues(new Uint8Array(32));
        const nonce = `0x${Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
        const validBefore = Math.floor(Date.now() / 1000) + EIP3009_VALIDITY_SECONDS; // 5 minutes TTL

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
            value: requestedAmount,
            validAfter: BigInt(0),
            validBefore: BigInt(validBefore),
            nonce: nonce as `0x${string}`,
        };

        // 5. Sign the Authorization Message
        const signature = await agentWallet.signTypedData({
            domain,
            types,
            primaryType: 'TransferWithAuthorization',
            message,
        });

        // 6. Construct Payment Proof (x402 V2 structure aligned with standard)
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

        // 7. Secondary Call with PAYMENT-SIGNATURE header & deferred file read
        const headers: Record<string, string> = {
            'PAYMENT-SIGNATURE': paymentProof,
            'X-Payment-Proof': paymentProof // Kept for backwards compatibility
        };

        let body: BodyInit;
        if (localFileMeta) {
            // Deferred read: only read buffer into memory now that the 402 challenge succeeded
            const buffer = await fs.promises.readFile(localFileMeta.resolvedPath);
            const formData = new FormData();
            const blob = new Blob([new Uint8Array(buffer)], { type: localFileMeta.mimeType });
            formData.append('file', blob, localFileMeta.filename);
            body = formData;
        } else {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify({ fileUrl });
        }

        let finalResponse: Response;
        try {
            finalResponse = await fetch(targetUrl, {
                method: 'POST',
                headers,
                body,
                signal: AbortSignal.timeout(120_000) // 120s timeout for heavy audio/lyrics AI models
            });
        } catch (networkError: any) {
            if (networkError.name === 'TimeoutError') {
                throw new Error(`Audio analysis timed out after 120 seconds. Processing took longer than expected.`);
            }
            throw new Error(`Failed to transmit signed analysis request: ${networkError.message}`);
        }

        if (!finalResponse.ok) {
            let errorMsg = `Analysis failed after payment (HTTP ${finalResponse.status})`;
            try {
                const error = await finalResponse.json();
                errorMsg = error.message || errorMsg;
                console.error("[🤖 TagPerTrackTool] Detailed backend error:", JSON.stringify(error, null, 2));
            } catch {
                try {
                    const rawText = await finalResponse.text();
                    if (rawText) errorMsg += `: ${rawText.slice(0, 300)}`;
                } catch {}
            }
            throw new Error(errorMsg);
        }

        const result = await finalResponse.json();
        console.log(`[🤖 TagPerTrackTool] Analysis completed successfully.`);

        return result.data;
    } finally {
        if (localFileCleanup) {
            await localFileCleanup();
        }
    }
}

/**
 * Runs tasks with a maximum concurrency limit.
 */
export async function runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let currentIndex = 0;

    async function worker() {
        while (currentIndex < items.length) {
            const index = currentIndex++;
            results[index] = await fn(items[index], index);
        }
    }

    const workerCount = Math.min(Math.max(limit, 1), items.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
    return results;
}

/**
 * Creates a LangChain tool for the Tag-per-Track audio analysis service.
 * This tool manages the full x402 payment challenge-response cycle.
 * Supports both local binary audio files via 'filePath' and remote URLs via 'fileUrl'.
 * 
 * @param agentWallet The wallet used to sign the x402 payment proof.
 * @param options Optional configuration (API URL, Builder Code, spending cap).
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

    // Generate ERC-8021 dataSuffix — defaults to Tag-per-Track builder code
    const builderCode = opts.builderCode || process.env.BUILDER_CODE || DEFAULT_BUILDER_CODE;
    const dataSuffix = getBuilderCodeDataSuffix([builderCode]);

    if (dataSuffix) {
        console.log(`[🏗️  BuilderCode] Attribution enabled: ${builderCode}`);
    }

    return new DynamicStructuredTool({
        name: "analyze_music_track",
        description:
            "Analyzes a music track or audio file to extract musical metadata (BPM, genre, mood, key, instruments, duration), AI music detection verdict (HUMAN vs AI_GENERATED Suno/Udio neural vocoders with confidence index in 'ai_detection'), and optionally vocal lyrics. " +
            "Supports local audio files via 'filePath' (read in binary and uploaded) or remote URLs via 'fileUrl'. " +
            "Note: This tool automatically executes a micro-payment (0.15 USDC for standard analysis, or 0.25 USDC when extractLyrics is enabled) via the x402 protocol on Base " +
            "using the agent's wallet signature.",

        schema: z.object({
            filePath: z.string()
                .optional()
                .describe("Path to a local audio file on disk (.mp3, .wav, .ogg, .flac, .m4a, .aac, .aiff). Use this whenever analyzing a local file, recording, or email attachment saved locally."),
            fileUrl: z.string()
                .optional()
                .describe("The direct publicly accessible URL (HTTP/HTTPS or IPFS) of the audio file to analyze."),
            extractLyrics: z.boolean()
                .optional()
                .describe("Optional: Set to true to transcribe and extract song lyrics in addition to metadata. Costs 0.25 USDC instead of 0.15 USDC."),
        }),

        func: async ({ filePath, fileUrl, extractLyrics }) => {
            try {
                const data = await executeAnalyzeAudio(
                    { filePath, fileUrl, extractLyrics },
                    agentWallet,
                    opts
                );
                return JSON.stringify(data, null, 2);
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
 * @param options Optional configuration (API URL, Builder Code, spending cap).
 * @returns A DynamicStructuredTool configured for lyrics extraction (0.25 USDC).
 */
export const createTagPerTrackWithLyricsTool = (
    agentWallet: AgentWallet,
    options: TagPerTrackToolOptions | string = {}
) => {
    const baseTool = createTagPerTrackTool(agentWallet, options);

    return new DynamicStructuredTool({
        name: "analyze_music_track_with_lyrics",
        description:
            "Analyzes an audio track or music file to extract complete musical metadata (BPM, genre, mood, key, instruments, duration) AND transcribe full vocal lyrics using AI. " +
            "Supports local audio files via 'filePath' (read in binary and uploaded) or remote URLs via 'fileUrl'. " +
            "Note: This tool automatically executes a micro-payment of 0.25 USDC via the x402 protocol on Base " +
            "using the agent's wallet signature.",

        schema: z.object({
            filePath: z.string()
                .optional()
                .describe("Path to a local audio file on disk (.mp3, .wav, .ogg, .flac, .m4a, .aac, .aiff). Use this whenever analyzing a local file, recording, or email attachment saved locally."),
            fileUrl: z.string()
                .optional()
                .describe("The direct publicly accessible URL (HTTP/HTTPS or IPFS) of the audio file to analyze."),
        }),

        func: async ({ filePath, fileUrl }) => {
            return await baseTool.invoke({ filePath, fileUrl, extractLyrics: true });
        }
    });
};

/**
 * Creates a LangChain tool for analyzing multiple music tracks in parallel with controlled concurrency.
 * Provides resilient, partial-success reporting.
 * 
 * @param agentWallet The wallet used to sign x402 payment proofs.
 * @param options Optional configuration (API URL, Builder Code, spending cap).
 * @returns A DynamicStructuredTool for batch audio analysis.
 */
export const createTagPerTrackBatchTool = (
    agentWallet: AgentWallet,
    options: TagPerTrackToolOptions | string = {}
) => {
    const opts: TagPerTrackToolOptions = typeof options === 'string'
        ? { apiUrl: options }
        : options;

    return new DynamicStructuredTool({
        name: "analyze_audio_batch",
        description:
            "Analyzes multiple music tracks or audio files in parallel (batch processing). " +
            "Vastly reduces total execution time compared to sequential processing. " +
            "Accepts a list of local file paths ('filePaths') or remote URLs ('fileUrls'), or a structured array of 'tracks'. " +
            "Executes micro-payments per track on Base via x402.",

        schema: z.object({
            tracks: z.array(z.object({
                filePath: z.string().optional().describe("Path to a local audio file on disk."),
                fileUrl: z.string().optional().describe("Direct public URL of the audio file."),
                extractLyrics: z.boolean().optional().describe("Whether to extract vocal lyrics for this track (costs 0.25 USDC instead of 0.15 USDC)."),
            })).optional().describe("Array of audio items to analyze in parallel. Each item can specify 'filePath' or 'fileUrl' and optional per-track 'extractLyrics'."),
            filePaths: z.array(z.string()).optional().describe("Convenience shortcut: list of local audio file paths to analyze in parallel."),
            fileUrls: z.array(z.string()).optional().describe("Convenience shortcut: list of remote audio URLs to analyze in parallel."),
            extractLyrics: z.boolean().optional().describe("Optional global flag: set to true to transcribe and extract vocal lyrics for all tracks in this batch (0.25 USDC per track). Default is false (0.15 USDC per track)."),
            concurrency: z.number().optional().describe("Maximum number of simultaneous parallel requests (1 to 5, default is 4 to respect API rate limits)."),
        }),

        func: async ({ tracks: inputTracks, filePaths, fileUrls, extractLyrics: globalExtractLyrics, concurrency: rawConcurrency }) => {
            const tracksToProcess: BatchTrackItem[] = [];

            if (Array.isArray(inputTracks) && inputTracks.length > 0) {
                tracksToProcess.push(...inputTracks);
            }
            if (Array.isArray(filePaths)) {
                for (const fp of filePaths) {
                    if (typeof fp === 'string' && fp.trim()) {
                        tracksToProcess.push({ filePath: fp.trim() });
                    }
                }
            }
            if (Array.isArray(fileUrls)) {
                for (const fu of fileUrls) {
                    if (typeof fu === 'string' && fu.trim()) {
                        tracksToProcess.push({ fileUrl: fu.trim() });
                    }
                }
            }

            if (tracksToProcess.length === 0) {
                return "Missing tracks for batch: Please provide 'tracks', 'filePaths', or 'fileUrls' array.";
            }

            const concurrency = Math.min(Math.max(rawConcurrency || 4, 1), 5);
            console.log(`[🤖 TagPerTrackTool] Starting batch analysis of ${tracksToProcess.length} track(s) with concurrency ${concurrency}...`);

            const results = await runWithConcurrency(
                tracksToProcess,
                concurrency,
                async (trackItem, index) => {
                    const label = trackItem.filePath
                        ? path.basename(trackItem.filePath)
                        : (trackItem.fileUrl ? trackItem.fileUrl.split('/').pop() || trackItem.fileUrl : `Track #${index + 1}`);

                    const itemExtractLyrics = trackItem.extractLyrics !== undefined
                        ? trackItem.extractLyrics
                        : Boolean(globalExtractLyrics);

                    try {
                        const data = await executeAnalyzeAudio(
                            { filePath: trackItem.filePath, fileUrl: trackItem.fileUrl, extractLyrics: itemExtractLyrics },
                            agentWallet,
                            opts
                        );
                        return {
                            track: label,
                            filePath: trackItem.filePath,
                            fileUrl: trackItem.fileUrl,
                            extractLyrics: itemExtractLyrics,
                            status: 'success' as const,
                            data
                        };
                    } catch (err: any) {
                        console.error(`[🤖 TagPerTrackTool] Batch item failed (${label}):`, err.message);
                        return {
                            track: label,
                            filePath: trackItem.filePath,
                            fileUrl: trackItem.fileUrl,
                            extractLyrics: itemExtractLyrics,
                            status: 'error' as const,
                            error: err.message || String(err)
                        };
                    }
                }
            );

            const successful = results.filter(r => r.status === 'success').length;
            const failed = results.filter(r => r.status === 'error').length;

            console.log(`[🤖 TagPerTrackTool] Batch completed: ${successful} succeeded, ${failed} failed.`);

            const batchResponse: BatchAnalysisResponse = {
                totalTracks: tracksToProcess.length,
                successful,
                failed,
                concurrency,
                results
            };

            return JSON.stringify(batchResponse, null, 2);
        }
    });
};

/**
 * Creates a LangChain tool for querying artist streaming traction and metrics on Spotify.
 * This is a free endpoint (no x402 micro-payment required) designed for A&R qualification.
 * 
 * @param options Optional configuration (API base URL).
 * @returns A DynamicStructuredTool ready to be used by an AI Agent.
 */
export const createLookupArtistStatsTool = (
    options: LookupArtistStatsToolOptions | string = {}
) => {
    const opts: LookupArtistStatsToolOptions = typeof options === 'string'
        ? { apiBaseUrl: options }
        : options;

    const baseApiUrl = (opts.apiBaseUrl || process.env.API_BASE_URL || "https://api.tag-per-track.cloud/api")
        .replace(/\/+$/, '')
        .replace(/\/analyze\/?$/, '');

    return new DynamicStructuredTool({
        name: "lookup_artist_stats",
        description:
            "Retrieves streaming traction and commercial metrics for an artist (Spotify monthly listeners, followers, popularity score, genres) " +
            "for A&R qualification and scouting. Free endpoint (no wallet or x402 payment required).",

        schema: z.object({
            artist_name: z.string()
                .optional()
                .describe("Stage name of the artist to look up (e.g., 'Daft Punk', 'Kaytranada')."),
            artistName: z.string()
                .optional()
                .describe("Alternative alias for artist_name."),
            social_links: z.array(z.string())
                .optional()
                .describe("Optional social media profile links for future enrichment."),
            socialLinks: z.array(z.string())
                .optional()
                .describe("Alternative alias for social_links."),
        }),

        func: async ({ artist_name, artistName, social_links, socialLinks }) => {
            const rawName = artist_name || artistName;
            const name = typeof rawName === 'string' ? rawName.trim() : '';

            if (!name) {
                return "Missing required parameter 'artist_name'. Please provide the stage name of the artist to look up.";
            }

            const links = social_links || socialLinks || [];

            try {
                const targetUrl = `${baseApiUrl}/artist-stats?name=${encodeURIComponent(name)}`;
                console.log(`[🤖 TagPerTrackTool] Looking up artist stats at: ${targetUrl}`);

                const response = await fetch(targetUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(15_000)
                });

                if (response.status === 404) {
                    return JSON.stringify({
                        status: "not_found",
                        artist: name,
                        message: `Artist "${name}" not found on Spotify.`,
                        social_links: links
                    }, null, 2);
                }

                if (!response.ok) {
                    const errorBody = await response.text().catch(() => "");
                    return `Backend API returned HTTP ${response.status} for artist "${name}": ${errorBody || response.statusText}`;
                }

                const data = await response.json();
                const enrichedResult: ArtistStatsResponse = {
                    ...data,
                    social_links: links
                };

                return JSON.stringify(enrichedResult, null, 2);
            } catch (error: any) {
                console.error(`[🤖 TagPerTrackTool] Error looking up artist stats:`, error.message);
                return `Error looking up artist stats for "${name}": ${error.message}`;
            }
        }
    });
};