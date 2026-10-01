export function formatUSD(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return `$${n.toFixed(2)}`;
}

export const SGD_RATE = 1.3;

export function formatSGD(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  const v = n * SGD_RATE;
  return `S$${v.toFixed(2)}`;
}
