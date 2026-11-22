// Generated from tools/squad/studio-renderer/artwork-source.ts; preserve the shared catalogue contracts.
const sides = { "front": "front", "back": "back", "left chest": "leftChest", "right chest": "rightChest", "left sleeve": "leftSleeve", "right sleeve": "rightSleeve", "inner label": "innerLabel" };
function studioArtworkPlacement(side, width, height) {
  const target = sides[side.trim().toLowerCase()], w = Number(width), h = Number(height);
  return target && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && w <= 100 && h <= 100 ? { side: target, widthInches: w, heightInches: h } : null;
}
export {
  studioArtworkPlacement
};
