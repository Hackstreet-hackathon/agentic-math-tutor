"use client";
import * as T from "@radix-ui/react-tooltip";

export function Tip({ label, children, side = "bottom" }: { label: string; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Provider delayDuration={400}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content side={side} sideOffset={6} className="z-[60] rounded-md bg-ink px-2 py-1 text-xs text-white shadow">
            {label}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
