import assert from 'node:assert/strict';
import {
  getClosestCorner,
  getCornerCoordinates,
  MINIMAP_WIDTH,
  MINIMAP_HEIGHT,
  MINIMAP_MARGIN_H,
  type MiniMapCorner,
} from '../src/lib/minimapCore';

console.log('--- Testing MovableCornerMiniMap 4-Corner Snap Logic ---');

const screenWidth = 390;
const screenHeight = 844;
const insetsTop = 47;
const insetsBottom = 34;

// 1. Verify Top-Left Corner Snap
const posTopLeft = getClosestCorner(10, 50, screenWidth, screenHeight);
assert.equal(posTopLeft, 'top-left', 'Upper-left drag position must snap strictly to top-left');

// 2. Verify Top-Right Corner Snap
const posTopRight = getClosestCorner(300, 50, screenWidth, screenHeight);
assert.equal(posTopRight, 'top-right', 'Upper-right drag position must snap strictly to top-right');

// 3. Verify Bottom-Left Corner Snap
const posBottomLeft = getClosestCorner(10, 600, screenWidth, screenHeight);
assert.equal(posBottomLeft, 'bottom-left', 'Lower-left drag position must snap strictly to bottom-left');

// 4. Verify Bottom-Right Corner Snap
const posBottomRight = getClosestCorner(300, 600, screenWidth, screenHeight);
assert.equal(posBottomRight, 'bottom-right', 'Lower-right drag position must snap strictly to bottom-right');

// 5. Verify Exact Target Coordinates for all 4 corners
const coordsTL = getCornerCoordinates('top-left', screenWidth, screenHeight, insetsTop, insetsBottom);
assert.equal(coordsTL.x, MINIMAP_MARGIN_H, 'Top-left x must match left margin');
assert.equal(coordsTL.y, insetsTop + 12, 'Top-left y must account for safe area top');

const coordsTR = getCornerCoordinates('top-right', screenWidth, screenHeight, insetsTop, insetsBottom);
assert.equal(coordsTR.x, screenWidth - MINIMAP_WIDTH - MINIMAP_MARGIN_H, 'Top-right x must be pinned to right margin');
assert.equal(coordsTR.y, insetsTop + 12, 'Top-right y must account for safe area top');

const coordsBL = getCornerCoordinates('bottom-left', screenWidth, screenHeight, insetsTop, insetsBottom);
assert.equal(coordsBL.x, MINIMAP_MARGIN_H, 'Bottom-left x must match left margin');
assert.equal(coordsBL.y, screenHeight - MINIMAP_HEIGHT - (insetsBottom + 24), 'Bottom-left y must account for safe area bottom');

const coordsBR = getCornerCoordinates('bottom-right', screenWidth, screenHeight, insetsTop, insetsBottom);
assert.equal(coordsBR.x, screenWidth - MINIMAP_WIDTH - MINIMAP_MARGIN_H, 'Bottom-right x must be pinned to right margin');
assert.equal(coordsBR.y, screenHeight - MINIMAP_HEIGHT - (insetsBottom + 24), 'Bottom-right y must account for safe area bottom');

// 6. Verify Fixed Dimensions (no resize, no reshape)
assert.equal(MINIMAP_WIDTH, 140, 'Width is strictly fixed to 140dp');
assert.equal(MINIMAP_HEIGHT, 190, 'Height is strictly fixed to 190dp');

console.log('✓ Test 1: getClosestCorner snaps correctly across all 4 screen quadrants');
console.log('✓ Test 2: getCornerCoordinates computes pixel-perfect bounds accounting for insets');
console.log('✓ Test 3: Fixed non-resizable dimensions enforced');
console.log('\nAll MovableCornerMiniMap 4-corner snap tests passed successfully!');
