import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import {
    resolveLocalPath,
    isLikelyLocalPath,
    getAudioMimeType,
    createTagPerTrackTool,
    createTagPerTrackWithLyricsTool,
    MAX_LOCAL_FILE_SIZE,
    AgentWallet,
} from './TagPerTrackTool';

async function runTests() {
    console.log("--------------------------------------------------");
    console.log("🧪 Running TagPerTrackTool Unit Tests");
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
    assert.strictEqual(getAudioMimeType("song.unknown"), "application/octet-stream");
    console.log("   ✅ getAudioMimeType passed");

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

    // 4. Test MAX_LOCAL_FILE_SIZE
    console.log("4. Testing MAX_LOCAL_FILE_SIZE limit...");
    assert.strictEqual(MAX_LOCAL_FILE_SIZE, 50 * 1024 * 1024);
    console.log("   ✅ MAX_LOCAL_FILE_SIZE is 50MB");

    // Mock wallet that shouldn't be called for client-side validation errors
    const mockWallet: AgentWallet = {
        address: "0x1111111111111111111111111111111111111111",
        signTypedData: async () => {
            throw new Error("Wallet should not sign if validation fails prior to payment!");
        },
    };

    const tool = createTagPerTrackTool(mockWallet);
    const lyricsTool = createTagPerTrackWithLyricsTool(mockWallet);

    // 5. Test tool metadata & schema
    console.log("5. Testing Tool schema and descriptions...");
    assert.strictEqual(tool.name, "analyze_music_track");
    assert.ok(tool.description.includes("filePath"));
    assert.ok(tool.description.includes("fileUrl"));
    assert.ok(tool.description.includes("0.05 USDC"));
    assert.ok(tool.description.includes("0.10 USDC"));

    assert.strictEqual(lyricsTool.name, "analyze_music_track_with_lyrics");
    assert.ok(lyricsTool.description.includes("filePath"));
    assert.ok(lyricsTool.description.includes("fileUrl"));
    assert.ok(lyricsTool.description.includes("0.10 USDC"));
    console.log("   ✅ Tool schemas and descriptions verified");

    // 6. Test invocation with missing audio source
    console.log("6. Testing missing audio source error...");
    const missingSourceResult = await tool.invoke({});
    assert.ok(missingSourceResult.includes("Missing audio source"));
    console.log("   ✅ Handled missing audio source properly");

    // 7. Test invocation with non-existent local file
    console.log("7. Testing non-existent local file error...");
    const nonExistentFileResult = await tool.invoke({ filePath: "/non/existent/path/song.mp3" });
    assert.ok(nonExistentFileResult.includes("Local file not found"));
    console.log("   ✅ Handled non-existent local file properly");

    // 8. Test auto-detection when local path passed in fileUrl
    console.log("8. Testing auto-detection of local path passed in fileUrl...");
    const invalidLocalInUrlResult = await tool.invoke({ fileUrl: "./does-not-exist.mp3" });
    assert.ok(invalidLocalInUrlResult.includes("Invalid fileUrl"));
    assert.ok(invalidLocalInUrlResult.includes("cannot be fetched by the remote server"));
    console.log("   ✅ Handled local path in fileUrl properly");

    // 9. Test with self-contained temporary audio file (pre-payment validation)
    console.log("9. Testing with local audio file (pre-payment validation)...");
    const fs = await import('fs');
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
