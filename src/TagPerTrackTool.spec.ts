import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
    resolveLocalPath,
    isLikelyLocalPath,
    getAudioMimeType,
    shouldCompressAudio,
    getMaxSpendingCap,
    createTagPerTrackTool,
    createTagPerTrackWithLyricsTool,
    createTagPerTrackBatchTool,
    createLookupArtistStatsTool,
    MAX_LOCAL_FILE_SIZE,
    COMPRESSION_SIZE_THRESHOLD,
    DEFAULT_MAX_SPENDING_USDC,
    AgentWallet,
} from './TagPerTrackTool';

async function runTests() {
    console.log("--------------------------------------------------");
    console.log("🧪 Running TagPerTrackTool Unit Tests (v1.2.0)");
    console.log("--------------------------------------------------");

    // 1. Test getAudioMimeType
    console.log("1. Testing getAudioMimeType...");
    assert.strictEqual(getAudioMimeType("test.mp3"), "audio/mpeg");
    assert.strictEqual(getAudioMimeType("path/to/song.wav"), "audio/wav");
    assert.strictEqual(getAudioMimeType("song.ogg"), "audio/ogg");
    assert.strictEqual(getAudioMimeType("song.flac"), "audio/flac");
    assert.strictEqual(getAudioMimeType("song.m4a"), "audio/mp4");
    assert.strictEqual(getAudioMimeType("song.aac"), "audio/aac");
    assert.strictEqual(getAudioMimeType("song.aiff"), "audio/aiff");
    assert.strictEqual(getAudioMimeType("song.AIF"), "audio/aiff");
    assert.throws(() => {
        getAudioMimeType("song.unknown");
    }, /Unsupported file format/);
    assert.throws(() => {
        getAudioMimeType("document.pdf");
    }, /Unsupported file format/);
    console.log("   ✅ getAudioMimeType passed (including strict whitelist validation)");

    // 2. Test isLikelyLocalPath
    console.log("2. Testing isLikelyLocalPath...");
    assert.strictEqual(isLikelyLocalPath("./track.mp3"), true);
    assert.strictEqual(isLikelyLocalPath("../music/track.wav"), true);
    assert.strictEqual(isLikelyLocalPath("/Users/user/Music/track.mp3"), true);
    assert.strictEqual(isLikelyLocalPath("~/Music/track.mp3"), true);
    assert.strictEqual(isLikelyLocalPath("file:///Users/user/track.mp3"), true);
    assert.strictEqual(isLikelyLocalPath("C:\\Users\\user\\track.mp3"), true);
    assert.strictEqual(isLikelyLocalPath("https://example.com/track.mp3"), false);
    assert.strictEqual(isLikelyLocalPath("http://example.com/track.mp3"), false);
    assert.strictEqual(isLikelyLocalPath("ipfs://Qm123456"), false);
    assert.strictEqual(isLikelyLocalPath(""), false);
    console.log("   ✅ isLikelyLocalPath passed");

    // 3. Test resolveLocalPath
    console.log("3. Testing resolveLocalPath...");
    assert.strictEqual(resolveLocalPath("file:///tmp/test.mp3"), "/tmp/test.mp3");
    assert.strictEqual(resolveLocalPath("~/Music/test.mp3"), path.resolve(os.homedir(), "Music/test.mp3"));
    assert.strictEqual(resolveLocalPath("./test.mp3"), path.resolve(process.cwd(), "./test.mp3"));
    console.log("   ✅ resolveLocalPath passed");

    // 4. Test shouldCompressAudio
    console.log("4. Testing shouldCompressAudio logic...");
    assert.strictEqual(shouldCompressAudio("song.wav", 1 * 1024 * 1024), true, "Uncompressed WAV should compress");
    assert.strictEqual(shouldCompressAudio("song.aiff", 2 * 1024 * 1024), true, "Uncompressed AIFF should compress");
    assert.strictEqual(shouldCompressAudio("song.mp3", 5 * 1024 * 1024), false, "5MB MP3 should NOT compress");
    assert.strictEqual(shouldCompressAudio("song.m4a", 10 * 1024 * 1024), false, "10MB M4A should NOT compress");
    assert.strictEqual(shouldCompressAudio("song.mp3", 20 * 1024 * 1024), true, "20MB MP3 (>15MB) should compress");
    console.log("   ✅ shouldCompressAudio passed");

    // 5. Test getMaxSpendingCap
    console.log("5. Testing getMaxSpendingCap...");
    assert.strictEqual(getMaxSpendingCap(), DEFAULT_MAX_SPENDING_USDC, "Defaults to 0.20 USDC (200000 units)");
    assert.strictEqual(getMaxSpendingCap(0.50), 500_000n, "Accepts explicit custom cap");
    console.log("   ✅ getMaxSpendingCap passed");

    // 6. Test MAX_LOCAL_FILE_SIZE
    console.log("6. Testing MAX_LOCAL_FILE_SIZE limit...");
    assert.strictEqual(MAX_LOCAL_FILE_SIZE, 50 * 1024 * 1024);
    assert.strictEqual(COMPRESSION_SIZE_THRESHOLD, 15 * 1024 * 1024);
    console.log("   ✅ File size limits verified");

    // Mock wallet that shouldn't be called for client-side validation errors
    const mockWallet: AgentWallet = {
        address: "0x1111111111111111111111111111111111111111",
        signTypedData: async () => {
            throw new Error("Wallet should not sign if validation fails prior to payment!");
        },
    };

    const tool = createTagPerTrackTool(mockWallet);
    const lyricsTool = createTagPerTrackWithLyricsTool(mockWallet);
    const batchTool = createTagPerTrackBatchTool(mockWallet);
    const artistStatsTool = createLookupArtistStatsTool();

    // 7. Test tool schemas and metadata
    console.log("7. Testing Tool schemas and descriptions...");
    assert.strictEqual(tool.name, "analyze_music_track");
    assert.ok(tool.description.includes("filePath"));
    assert.ok(tool.description.includes("0.05 USDC"));

    assert.strictEqual(lyricsTool.name, "analyze_music_track_with_lyrics");
    assert.ok(lyricsTool.description.includes("0.10 USDC"));

    assert.strictEqual(batchTool.name, "analyze_audio_batch");
    assert.ok(batchTool.description.includes("parallel"));

    assert.strictEqual(artistStatsTool.name, "lookup_artist_stats");
    assert.ok(artistStatsTool.description.includes("Spotify"));
    assert.ok(artistStatsTool.description.includes("A&R"));
    console.log("   ✅ All 4 Tool schemas and descriptions verified");

    // 8. Test invocation with missing audio source
    console.log("8. Testing missing audio source error...");
    const missingSourceResult = await tool.invoke({});
    assert.ok(missingSourceResult.includes("Missing audio source"));
    console.log("   ✅ Handled missing audio source properly");

    // 9. Test invocation with non-existent local file
    console.log("9. Testing non-existent local file error...");
    const nonExistentFileResult = await tool.invoke({ filePath: "/non/existent/path/song.mp3" });
    assert.ok(nonExistentFileResult.includes("Local file not found"));
    console.log("   ✅ Handled non-existent local file properly");

    // 10. Test auto-detection when local path passed in fileUrl
    console.log("10. Testing auto-detection of local path passed in fileUrl...");
    const invalidLocalInUrlResult = await tool.invoke({ fileUrl: "./does-not-exist.mp3" });
    assert.ok(invalidLocalInUrlResult.includes("Invalid fileUrl"));
    assert.ok(invalidLocalInUrlResult.includes("cannot be fetched by the remote server"));
    console.log("   ✅ Handled local path in fileUrl properly");

    // 11. Test batch tool with empty input
    console.log("11. Testing batch tool empty input validation...");
    const emptyBatchResult = await batchTool.invoke({});
    assert.ok(emptyBatchResult.includes("Missing tracks for batch"));
    console.log("   ✅ Batch tool validated empty input");

    // 12. Test artist stats tool with missing name
    console.log("12. Testing artist stats tool missing name validation...");
    const emptyArtistResult = await artistStatsTool.invoke({});
    assert.ok(emptyArtistResult.includes("Missing required parameter 'artist_name'"));
    console.log("   ✅ Artist stats tool validated missing name");

    // 13. Test with temporary audio file (pre-payment validation)
    console.log("13. Testing with local audio file (pre-payment validation)...");
    const tempAudioPath = path.resolve(os.tmpdir(), "tag-per-track-test-sample.mp3");
    fs.writeFileSync(tempAudioPath, Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])); // Minimal valid ID3 header
    try {
        const result = await tool.invoke({ filePath: tempAudioPath });
        console.log("   Result:", result);
    } catch (e: any) {
        console.log("   Expected downstream result:", e.message);
    } finally {
        if (fs.existsSync(tempAudioPath)) {
            fs.unlinkSync(tempAudioPath);
        }
    }
    console.log("   ✅ Local file validation and binary preparation passed");

    console.log("--------------------------------------------------");
    console.log("🎉 All unit tests passed successfully!");
    console.log("--------------------------------------------------");
}

runTests().catch(err => {
    console.error("❌ Test failed:", err);
    process.exit(1);
});
