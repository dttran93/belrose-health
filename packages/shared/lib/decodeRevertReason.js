// Decodes a standard Error(string) ABI revert: selector 0x08c379a0 + ABI-encoded string.
// Returns the human-readable reason, or null if the error doesn't contain one. Pure and
// dependency-free (no ethers/firebase), shared between the frontend
// (blockchainSyncQueueService.ts) and functions (blockchainSyncRetryService.ts) — the two need
// to classify the exact same revert messages, so a single source of truth matters here more
// than it would for a typical small helper.
export function decodeRevertReason(error) {
    const data = error.match(/0x08c379a0([0-9a-f]+)/i)?.[1];
    if (!data || data.length < 128)
        return null;
    try {
        const length = parseInt(data.slice(64, 128), 16);
        if (length === 0 || length > 1024)
            return null;
        const stringHex = data.slice(128, 128 + length * 2);
        const bytes = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            bytes[i] = parseInt(stringHex.slice(i * 2, i * 2 + 2), 16);
        }
        return new TextDecoder().decode(bytes);
    }
    catch {
        return null;
    }
}
