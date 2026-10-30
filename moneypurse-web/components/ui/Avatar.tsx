export function Avatar({ initials }: { initials: string }) {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-surface-base text-sm font-semibold">
      {initials}
    </div>
  );
}
