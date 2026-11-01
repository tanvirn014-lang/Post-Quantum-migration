import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export function Drawer({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-navy/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed right-0 top-0 h-full w-full max-w-md bg-surface-raised p-6 overflow-y-auto shadow-e5 border-l border-subtle">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold text-primary">{title}</Dialog.Title>
            <Dialog.Close className="text-muted hover:text-primary" aria-label="Close">
              ✕
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
