// "100% win · 153 seen · 64.8 ⚑" for a counter squad, showing whichever
// stats it has. Nothing at all when it has none.
export function formatCount(n) {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export default function StatsLine({ squad }) {
  const parts = [];
  if (squad.win_rate != null) parts.push(["win", `${squad.win_rate}%`]);
  if (squad.seen_count != null) parts.push(["seen", formatCount(squad.seen_count)]);
  if (squad.avg_banners != null) parts.push(["⚑ avg", squad.avg_banners]);
  if (parts.length === 0) return null;
  return (
    <div className="stats-line">
      {parts.map(([label, value]) => (
        <span key={label}>
          <strong>{value}</strong> {label}
        </span>
      ))}
    </div>
  );
}
