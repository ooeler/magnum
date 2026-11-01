// Gemeinsame Sicherheits-Helfer der Edge Functions. Reine Logik, damit sie getestet werden kann.

// Vergleicht Secrets in konstanter Zeit (verrät über die Antwortzeit nicht, wie viele Zeichen stimmen)
export function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a ?? "")), y = new TextEncoder().encode(String(b ?? ""));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0 && x.length > 0;
}
