export interface RenderStats {
  postProcessorCalls: number;
  sectionInfoNull: number;
  blocksSeen: number;
  recordHits: number;
  spansLocated: number;
  marksApplied: number;
  fallbackSpansUsed: number;
  liveViews: number;
  liveBuilds: number;
  liveStoreHits: number;
  liveMarksBuilt: number;
}

export const stats: RenderStats = {
  postProcessorCalls: 0,
  sectionInfoNull: 0,
  blocksSeen: 0,
  recordHits: 0,
  spansLocated: 0,
  marksApplied: 0,
  fallbackSpansUsed: 0,
  liveViews: 0,
  liveBuilds: 0,
  liveStoreHits: 0,
  liveMarksBuilt: 0,
};

export function renderStats(): RenderStats {
  return { ...stats };
}
