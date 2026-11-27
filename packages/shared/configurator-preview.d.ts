export interface PreviewAssetGeometry { height_ratio?: string | number | null; offset_x?: string | number | null; offset_y?: string | number | null; mirror_offset_x?: string | number | null }
export function previewGeometry(asset: PreviewAssetGeometry, mirror?: boolean): { left: string; top: string; height: string; transform: string | undefined };
export function nativePreviewGeometry(asset: PreviewAssetGeometry, mirror?: boolean): { x: number; y: number; height: number; mirror: boolean };
export function previewLayers<T extends { asset: PreviewAssetGeometry; layerSort?: string | number | null }>(base: T[], addons: T[]): Array<T & { mirror: boolean }>;
export function previewColor(color: string | null | undefined): string | null;
