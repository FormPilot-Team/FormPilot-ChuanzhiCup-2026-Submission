// Copied from FormPilot_v3: src/features/pose/fitMapping.ts (commit 9cf6c24, 2026-10-02).
// Verbatim copy.

export interface FitMappingInput {
  destWidth: number
  destHeight: number
  sourceWidth: number
  sourceHeight: number
  fit: 'cover' | 'contain'
  mirrored: boolean
}

export interface MappedPoint {
  x: number
  y: number
}

export function mapNormalizedLandmarkToCanvas(
  x: number,
  y: number,
  mapping: FitMappingInput,
): MappedPoint {
  const scale = mapping.fit === 'cover'
    ? Math.max(mapping.destWidth / mapping.sourceWidth, mapping.destHeight / mapping.sourceHeight)
    : Math.min(mapping.destWidth / mapping.sourceWidth, mapping.destHeight / mapping.sourceHeight)
  const renderedWidth = mapping.sourceWidth * scale
  const renderedHeight = mapping.sourceHeight * scale
  const offsetX = (mapping.destWidth - renderedWidth) / 2
  const offsetY = (mapping.destHeight - renderedHeight) / 2
  return {
    x: offsetX + (mapping.mirrored ? 1 - x : x) * renderedWidth,
    y: offsetY + y * renderedHeight,
  }
}
