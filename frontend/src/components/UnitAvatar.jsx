import { imageUrl } from "../api.js";
import { initials } from "../unitSearch.js";

// Stable per-name hue so placeholder avatars are easy to tell apart.
function hue(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// Portrait if one's been uploaded, otherwise an initials placeholder.
// Ships are drawn as rounded squares, characters as circles (like in-game).
export default function UnitAvatar({ unit, size = 40, leader = false }) {
  const src = imageUrl(unit.image_path);
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.32) };
  const className = `avatar${unit.is_ship ? " ship" : ""}${leader ? " leader" : ""}`;

  if (src) {
    return (
      <span className={className} style={style} title={unit.name}>
        <img src={src} alt="" loading="lazy" />
      </span>
    );
  }
  return (
    <span
      className={`${className} placeholder`}
      style={{ ...style, "--avatar-hue": hue(unit.name) }}
      title={unit.name}
      aria-hidden="true"
    >
      {initials(unit.name).slice(0, 3).toUpperCase()}
    </span>
  );
}
