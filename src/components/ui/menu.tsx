"use client";
import * as M from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: React.ReactNode }) => (
  <M.Label className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted">{children}</M.Label>
);

export function MenuContent({ children, align = "end" }: { children: React.ReactNode; align?: "start" | "end" | "center" }) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className="z-50 min-w-48 rounded-xl border border-line bg-white p-1 shadow-lg"
      >
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({
  className,
  danger,
  ...props
}: React.ComponentProps<typeof M.Item> & { danger?: boolean }) {
  return (
    <M.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-black/5",
        danger && "text-danger",
        className,
      )}
      {...props}
    />
  );
}
