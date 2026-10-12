// "100% win · 64.8 ⚑ avg" for a counter squad, showing whichever stats it
// has. Nothing at all when it has none. (How often a squad was "seen" is
// stored and still weighs the ranking, but isn't shown - it's a per-season
// number that goes stale.)
export default function StatsLine({ squad }) {
  const parts = [];
  if (squad.win_rate != null) parts.push(["win", `${squad.win_rate}%`]);
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
