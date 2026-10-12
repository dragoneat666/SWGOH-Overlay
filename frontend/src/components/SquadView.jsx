import UnitAvatar from "./UnitAvatar.jsx";

// Read-only squad display: leader first with a gold ring, then members.
export default function SquadView({ squad, size = 40 }) {
  if (!squad || squad.units.length === 0) {
    return <span className="muted">No units</span>;
  }
  const [leader, ...members] = squad.units;
  return (
    <div className="squad-view">
      <div className="squad-avatars">
        {squad.units.map((unit, i) => (
          <UnitAvatar key={unit.id} unit={unit} size={i === 0 ? size + 6 : size} leader={i === 0} />
        ))}
      </div>
      <div className="squad-names">
        <strong>{leader.name}</strong>
        {members.length > 0 && <span className="muted"> · {members.map((u) => u.name).join(", ")}</span>}
      </div>
    </div>
  );
}
