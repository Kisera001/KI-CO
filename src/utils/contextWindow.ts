export function selectCacheFriendlyWindow<T>(items: T[], limit: number): T[] {
  const safeLimit = Math.max(1, Math.round(Number(limit) || 1));
  if (items.length <= safeLimit) return items;

  const tailSize = Math.min(safeLimit, Math.max(4, Math.floor(safeLimit * 0.35)));
  const anchorSize = Math.max(0, safeLimit - tailSize);
  const tailItems = items.slice(-tailSize);
  const beforeTail = items.slice(0, Math.max(0, items.length - tailSize));

  if (anchorSize <= 0 || beforeTail.length <= 0) return tailItems;
  if (beforeTail.length <= anchorSize) return [...beforeTail, ...tailItems];

  const desiredStart = beforeTail.length - anchorSize;
  const snapUnit = Math.max(4, tailSize);
  const snappedStart = Math.floor(desiredStart / snapUnit) * snapUnit;
  const anchorItems = beforeTail.slice(snappedStart, snappedStart + anchorSize);

  return [...anchorItems, ...tailItems];
}

