export function shouldBypassImageOptimization(src: string): boolean {
  const url = src.toLowerCase();
  return url.includes("x-amz-signature") || url.includes("x-amz-credential") || url.includes("x-amz-security-token");
}
