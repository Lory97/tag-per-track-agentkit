import { Attribution } from "ox/erc8021";

/**
 * Configuration for Base Builder Code attribution (ERC-8021).
 *
 * Builder Codes allow you to attribute on-chain transactions to your identity
 * on Base, unlocking analytics and leaderboard features on base.dev.
 *
 * @see https://docs.base.org/base-chain/builder-codes/app-developers
 */

/** Default Builder Code for Tag-per-Track on-chain attribution. */
export const DEFAULT_BUILDER_CODE = "bc_3tdradhx";

/**
 * Generates the ERC-8021 dataSuffix from one or more Builder Codes.
 * This suffix must be appended to transaction calldata for attribution.
 *
 * @param codes - One or more Builder Codes (e.g. ["bc_xxxxxxxx"])
 * @returns The hex-encoded dataSuffix to append to transactions
 *
 * @example
 * ```ts
 * const suffix = getBuilderCodeDataSuffix(["bc_b7k3p9da"]);
 * // Use with viem walletClient:
 * const hash = await walletClient.sendTransaction({
 *   to: "0x...",
 *   value: parseEther("0.01"),
 *   dataSuffix: suffix,
 * });
 * ```
 */
export function getBuilderCodeDataSuffix(codes: string[]): `0x${string}` {
    if (!codes.length) {
        throw new Error("[BuilderCode] At least one Builder Code is required.");
    }
    return Attribution.toDataSuffix({ codes });
}

/**
 * Reads the Builder Code from the BUILDER_CODE environment variable.
 * Falls back to the provided default if the env var is not set.
 *
 * @param fallback - Optional default Builder Code
 * @returns The dataSuffix hex string, or undefined if no code is available
 */
export function getBuilderCodeFromEnv(fallback: string = DEFAULT_BUILDER_CODE): `0x${string}` {
    const code = process.env.BUILDER_CODE || fallback;
    return getBuilderCodeDataSuffix([code]);
}
