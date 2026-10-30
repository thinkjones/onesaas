/** One pinned number: the value large, its title underneath. */
export default function StatView({ title, value }: { title: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius)] border p-4">
      <span className="text-5xl font-bold">{value}</span>
      <span className="text-base text-muted-foreground">{title}</span>
    </div>
  );
}
