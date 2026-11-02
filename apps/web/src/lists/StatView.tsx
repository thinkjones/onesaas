/** One pinned number as a Craft field tile (§9): key above, value below. */
export default function StatView({ title, value }: { title: string; value: number }) {
  return (
    <div className="tile">
      <div className="k">{title}</div>
      <div className="v text-5xl">{value}</div>
    </div>
  );
}
