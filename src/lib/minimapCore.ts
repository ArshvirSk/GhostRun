export type MiniMapCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const STORAGE_KEY_MINIMAP_CORNER = '@ghostrun:headstart_minimap_corner';
export const STORAGE_KEY_MINIMAP_ENABLED = '@ghostrun:headstart_minimap_enabled';

export const MINIMAP_WIDTH = 140;
export const MINIMAP_HEIGHT = 190;
export const MINIMAP_MARGIN_H = 16;

/**
 * Calculates absolute (x, y) target for a given corner based on screen bounds and insets.
 */
export function getCornerCoordinates(
  corner: MiniMapCorner,
  screenWidth: number,
  screenHeight: number,
  insetsTop: number,
  insetsBottom: number,
  boxWidth: number = MINIMAP_WIDTH,
  boxHeight: number = MINIMAP_HEIGHT,
  marginH: number = MINIMAP_MARGIN_H,
) {
  const topMargin = Math.max(insetsTop, 16) + 12;
  const bottomMargin = Math.max(insetsBottom, 16) + 24;

  switch (corner) {
    case 'top-left':
      return { x: marginH, y: topMargin };
    case 'top-right':
      return { x: Math.max(marginH, screenWidth - boxWidth - marginH), y: topMargin };
    case 'bottom-left':
      return { x: marginH, y: Math.max(topMargin, screenHeight - boxHeight - bottomMargin) };
    case 'bottom-right':
      return {
        x: Math.max(marginH, screenWidth - boxWidth - marginH),
        y: Math.max(topMargin, screenHeight - boxHeight - bottomMargin),
      };
  }
}

/**
 * Determines which of the 4 corners is closest to the given (x, y) coordinate.
 * Disallows arbitrary stop points: only the 4 cardinal screen corners are valid.
 */
export function getClosestCorner(
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
  boxWidth: number = MINIMAP_WIDTH,
  boxHeight: number = MINIMAP_HEIGHT,
): MiniMapCorner {
  const centerX = x + boxWidth / 2;
  const centerY = y + boxHeight / 2;

  const isLeft = centerX < screenWidth / 2;
  const isTop = centerY < screenHeight / 2;

  if (isTop && isLeft) return 'top-left';
  if (isTop && !isLeft) return 'top-right';
  if (!isTop && isLeft) return 'bottom-left';
  return 'bottom-right';
}
