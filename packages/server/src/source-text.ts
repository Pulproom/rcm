export function stripThoughtBlocks(value: string): string {
  return value.replace(/<thoughts\b[^>]*>[\s\S]*?<\/thoughts\s*>/gi, "").trimStart();
}
