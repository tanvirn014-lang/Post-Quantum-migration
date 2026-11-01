export function Avatar({ initials }: { initials: string }) {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-on-dark text-sm font-semibold">
      {initials}
    </div>
  );
}
