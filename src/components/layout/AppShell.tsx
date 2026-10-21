import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  ClipboardCheck,
  FileStack,
  FolderKanban,
  Gauge,
  Images,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  PlusCircle,
  ScrollText,
  UserRound,
  Users,
  Waves,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";

const OWNER_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/my-projects", label: "My Projects", icon: FolderKanban },
  { to: "/register-project", label: "Register Project", icon: PlusCircle },
  { to: "/evidence", label: "Evidence", icon: Images },
  { to: "/community-share", label: "Community Stories", icon: Users },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/profile", label: "Profile", icon: UserRound },
] as const;

const VERIFIER_NAV = [
  { to: "/verifier", label: "Dashboard", icon: LayoutDashboard },
  { to: "/queue", label: "Verification Queue", icon: ClipboardCheck },
  { to: "/registry", label: "Projects", icon: FileStack },
  { to: "/registry-map", label: "Map", icon: MapIcon },
  { to: "/community-review", label: "Community Review", icon: Users },
  { to: "/marketplace-interests", label: "Marketplace Interest", icon: Building2 },
  { to: "/analytics", label: "Analytics", icon: Gauge },
  { to: "/audit-logs", label: "Audit Logs", icon: ScrollText },
  { to: "/notifications", label: "Notifications", icon: Bell },
] as const;

export function AppShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { profile, isVerifier, signOut, user } = useAuth();
  const navigate = useNavigate();
  const nav = isVerifier ? VERIFIER_NAV : OWNER_NAV;

  const { data: unread } = useQuery({
    queryKey: ["unread-count", user?.email],
    enabled: !!user?.email,
    queryFn: async () => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("read", false);
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });

  const navList = (
    <nav className="space-y-1">
      {nav.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
        >
          <item.icon className="size-4" />
          <span className="flex-1">{item.label}</span>
          {item.label === "Notifications" && unread ? (
            <span className="rounded-full bg-sidebar-primary px-1.5 text-[0.65rem] font-bold text-sidebar-primary-foreground">
              {unread}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between bg-sidebar p-4 lg:flex">
        <div>
          <Link to="/" className="mb-6 flex items-center gap-2.5 px-1">
            <span className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary/20 text-sidebar-primary">
              <Waves className="size-4.5" />
            </span>
            <span className="leading-tight">
              <span className="block font-display text-sm font-semibold text-sidebar-foreground">
                BlueCarbon MRV
              </span>
              <span className="block text-[0.65rem] uppercase tracking-[0.16em] text-sidebar-foreground/60">
                {isVerifier ? "NCCR Verifier" : "Project Owner"}
              </span>
            </span>
          </Link>
          {navList}
        </div>
        <div className="rounded-xl bg-sidebar-accent/60 p-3">
          <p className="truncate text-sm font-semibold text-sidebar-foreground">
            {profile?.full_name ?? profile?.email ?? "Signed in"}
          </p>
          <p className="truncate text-xs text-sidebar-foreground/60">
            {profile?.organization ?? profile?.email}
          </p>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              await navigate({ to: "/" });
            }}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-sidebar-border px-3 py-1.5 text-xs font-semibold text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-card/90 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Sheet>
                <SheetTrigger
                  className="mt-1 rounded-lg border border-border p-2 lg:hidden"
                  aria-label="Open menu"
                >
                  <Menu className="size-4" />
                </SheetTrigger>
                <SheetContent side="left" className="w-72 bg-sidebar p-4">
                  <div className="mt-8">{navList}</div>
                  <button
                    type="button"
                    onClick={async () => {
                      await signOut();
                      await navigate({ to: "/" });
                    }}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-sidebar-border px-3 py-2 text-xs font-semibold text-sidebar-foreground"
                  >
                    <LogOut className="size-3.5" /> Sign out
                  </button>
                </SheetContent>
              </Sheet>
              <div>
                <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                  {title}
                </h1>
                {description ? (
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
                ) : null}
              </div>
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
          </div>
        </header>
        <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</div>
      </div>
    </div>
  );
}
