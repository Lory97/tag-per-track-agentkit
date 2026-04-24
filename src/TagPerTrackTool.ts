import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getBuilderCodeDataSuffix, DEFAULT_BUILDER_CODE } from "./builderCode";

// Re-export builder code utilities for consumers
export { getBuilderCodeDataSuffix, getBuilderCodeFromEnv, DEFAULT_BUILDER_CODE } from "./builderCode";

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
            "Analyzes a music track or audio file to extract advanced metadata like BPM, genre, mood, and key. " +
            "Provide the URL of the audio file (.mp3, .wav, .ogg). " +
            "Note: This tool automatically executes a micro-payment (0.05 USDC) via the x402 protocol " +
            "using the agent's wallet signature.",

        schema: z.object({
            fileUrl: z.string()
                .url("Must be a valid HTTP/HTTPS URL")
                .describe("The direct URL of the audio file to analyze (supports mp3, wav, ogg, flac)."),
        }),

        func: async ({ fileUrl }) => {
            try {
                console.log(`[🤖 TagPerTrackTool] Starting analysis for: ${fileUrl}`);

                // 1. Initial Request (Triggers 402 Payment Required)
                const initialResponse = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fileUrl })
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

                console.log(`[🤖 TagPerTrackTool] 402 Received. Preparing EIP-3009 signature for payment...`);

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
                        url: apiUrl,
                        description: 'Tag-per-Track: Agentic-First Musical Audio Analysis API. Extracts BPM, Key, Mood, Genres and Instruments from audio URLs.',
                        mimeType: 'application/json',
                    },
                    extensions: requirements.extensions
                });

                console.log(`[🤖 TagPerTrackTool] Proof generated and signed. Re-submitting request...`);

                // 6. Secondary Call with PAYMENT-SIGNATURE header
                const finalResponse = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'PAYMENT-SIGNATURE': paymentProof,
                        'X-Payment-Proof': paymentProof // Kept for backwards compatibility
                    },
                    body: JSON.stringify({ fileUrl })
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