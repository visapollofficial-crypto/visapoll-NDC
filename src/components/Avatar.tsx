export function Avatar({ name, url, size = 40 }: { name: string; url: string | null; size?: number }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return url ? (
    <img className="avatar" src={url} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <span className="avatar fallback" style={{ width: size, height: size }} aria-hidden="true">{initials}</span>
  );
}
