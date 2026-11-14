import {
  buildInvitePayload,
  parseInviteUrl,
  normalizeRoomCode,
  generateAssetLinksJson,
  generateFallbackLandingHtml,
  DEFAULT_INVITE_DOMAIN,
  DEFAULT_CUSTOM_SCHEME,
} from '../src/lib/invite';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`PASS: ${message}`);
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

console.log('--- NF-02 Invite & Deep-Linking Unit Tests ---');

// Test 1: Code normalization
assert(normalizeRoomCode(' ab12 ') === 'AB12', 'Normalizes lowercase and whitespace to 4 uppercase chars');
assert(normalizeRoomCode('abcd-efgh') === 'ABCD', 'Strips punctuation and truncates to 4 chars');
assert(normalizeRoomCode('!!!') === '', 'Handles pure punctuation cleanly');

// Test 2: Build Invite Payload (defaults)
const payload1 = buildInvitePayload({ code: 'k9p2' });
assert(payload1.code === 'K9P2', 'Payload normalizes code to uppercase');
assert(payload1.title.includes('Classic Chase'), 'Payload defaults mode name to Classic Chase');
assert(payload1.deepLink === `${DEFAULT_CUSTOM_SCHEME}://join?code=K9P2`, 'Payload builds proper custom scheme deep link');
assert(payload1.webLink === `${DEFAULT_INVITE_DOMAIN}/join/K9P2`, 'Payload builds proper web fallback link');
assert(payload1.message.includes('Lobby Code: K9P2'), 'Payload message includes lobby code');
assert(payload1.message.includes(payload1.deepLink), 'Payload message includes deep link');
assert(payload1.message.includes(payload1.webLink), 'Payload message includes web fallback');

// Test 3: Build Invite Payload (custom options)
const payload2 = buildInvitePayload({
  code: 'Z8R4',
  modeName: 'Tag Hunt',
  baseUrl: 'https://custom.ghostrun.io/',
  scheme: 'ghostrun-beta',
});
assert(payload2.deepLink === 'ghostrun-beta://join?code=Z8R4', 'Payload respects custom scheme');
assert(payload2.webLink === 'https://custom.ghostrun.io/join/Z8R4', 'Payload respects custom base URL without double slashes');
assert(payload2.title === 'GhostRun: Join Tag Hunt', 'Payload formats custom title');

// Test 4: Parse Invite URL - Direct code
const parsedDirect = parseInviteUrl('q4w8');
assert(parsedDirect.isValid && parsedDirect.code === 'Q4W8' && parsedDirect.source === 'code', 'Parses direct 4-char code');

// Test 5: Parse Invite URL - Deep link query param
const parsedDeepQuery = parseInviteUrl('ghost-run://join?code=m7x1');
assert(parsedDeepQuery.isValid && parsedDeepQuery.code === 'M7X1' && parsedDeepQuery.source === 'deepLink', 'Parses custom scheme query param');

// Test 6: Parse Invite URL - Deep link path
const parsedDeepPath = parseInviteUrl('ghost-run://join/t3v9');
assert(parsedDeepPath.isValid && parsedDeepPath.code === 'T3V9' && parsedDeepPath.source === 'deepLink', 'Parses custom scheme path segment');

// Test 7: Parse Invite URL - Web link path
const parsedWebPath = parseInviteUrl('https://ghostrun.app/join/f5b2');
assert(parsedWebPath.isValid && parsedWebPath.code === 'F5B2' && parsedWebPath.source === 'webLink', 'Parses web path link');

// Test 8: Parse Invite URL - Web link query with extra params
const parsedWebQuery = parseInviteUrl('https://ghostrun.app/join?code=h8j4&source=discord');
assert(parsedWebQuery.isValid && parsedWebQuery.code === 'H8J4' && parsedWebQuery.source === 'webLink', 'Parses web query link with extra parameters');

// Test 9: Parse Invite URL - Invalid / garbage input
const parsedInvalid = parseInviteUrl('not-a-valid-link');
assert(!parsedInvalid.isValid && parsedInvalid.code === null, 'Rejects invalid string');

// Test 10: Digital Asset Links JSON generation
const assetLinksRaw = generateAssetLinksJson();
let assetLinksParsed: any = null;
try {
  assetLinksParsed = JSON.parse(assetLinksRaw);
} catch (e) {
  // ignore
}
assert(Array.isArray(assetLinksParsed), 'Asset links produces valid JSON array');
assert(assetLinksParsed[0]?.relation?.[0] === 'delegate_permission/common.handle_all_urls', 'Asset links declares handle_all_urls permission');
assert(assetLinksParsed[0]?.target?.package_name === 'com.ghostrun.app', 'Asset links specifies com.ghostrun.app');

// Test 11: Fallback Landing HTML generation
const html = generateFallbackLandingHtml({ code: 'e4r7', modeName: 'Jailbreak' });
assert(html.includes('<title>GhostRun - Join Match E4R7</title>'), 'HTML includes title with code');
assert(html.includes('E4R7'), 'HTML displays the room code');
assert(html.includes('Jailbreak'), 'HTML renders the mode name');
assert(html.includes('ghost-run://join?code=E4R7'), 'HTML provides direct deep link button');
assert(html.includes('play.google.com'), 'HTML provides Play Store download button');
assert(html.includes('window.location.href = "ghost-run://join?code=E4R7"'), 'HTML includes mobile auto-redirect script');

console.log(`\nTest results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
