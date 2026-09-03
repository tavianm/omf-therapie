export function isWideLandscapePanel(
  width: number,
  isLandscape: boolean,
): boolean {
  return width >= 1024 && isLandscape;
}
