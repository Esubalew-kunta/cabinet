export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="skeleton size-10 rounded-xl" />
        <div className="space-y-2">
          <div className="skeleton h-5 w-44" />
          <div className="skeleton h-3 w-64" />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <div className="skeleton h-4 w-36" />
            </div>
            <div className="space-y-3 p-4">
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-5/6" />
              <div className="skeleton h-3 w-4/6" />
              <div className="skeleton h-3 w-3/6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
