export function garmentImagePath(processedPath: string | null | undefined, originalPath: string | null | undefined) {
  return processedPath || originalPath || null;
}
