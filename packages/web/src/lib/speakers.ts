// A stable hue per Discord user so a speaker keeps one colour across the
// transcript and the recap's table stats.
export function speakerHue(userId: string): number {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}
