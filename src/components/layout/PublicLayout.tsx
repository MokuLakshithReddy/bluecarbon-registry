import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, Waves } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/projects", label: "Projects" },
  { to: "/map", label: "Map" },
  { to: "/how-it-works", label: "How It Works" },
  { to: "/about", label: "About" },
] as const;

export function PublicLayout({ children }: { children: ReactNode }) {
  const { session, isVerifier } = useAuth();

  const links = (
    <>
      {NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: item.to === "/" }}
          activeProps={{ className: "text-foreground font-semibold" }}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {item.label}
        </Link>
      ))}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-gradient-deep text-navy-foreground">
              <Waves className="size-4.5" />
            </span>
            <span className="leading-tight">
              <span className="block font-display text-sm font-semibold tracking-tight">
                BlueCarbon MRV Registry
              </span>
              <span className="block text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                MoES · NCCR Demonstration
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-6 lg:flex">{links}</nav>

          <div className="flex items-center gap-2">
            <Link
              to={session ? (isVerifier ? "/verifier" : "/dashboard") : "/auth"}
              className="hidden rounded-lg border border-border px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-secondary sm:inline-flex"
            >
              {session ? "Dashboard" : "Sign In"}
            </Link>
            <Link
              to="/register-project"
              className="hidden rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:inline-flex"
            >
              Register a Project
            </Link>
            <Sheet>
              <SheetTrigger className="rounded-lg border border-border p-2 lg:hidden" aria-label="Open menu">
                <Menu className="size-4" />
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <nav className="mt-8 flex flex-col gap-4">
                  {links}
                  <Link to="/auth" className="text-sm font-semibold text-primary">
                    {session ? "Go to dashboard" : "Sign in"}
                  </Link>
                  <Link to="/register-project" className="text-sm font-semibold text-primary">
                    Register a Project
                  </Link>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border bg-navy text-navy-foreground">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <p className="font-display text-lg font-semibold">BlueCarbon MRV Registry</p>
            <p className="mt-2 max-w-md text-sm text-navy-foreground/70">
              A trusted digital MRV and registry system that connects field evidence, automated validation,
              human verification, tamper-evident records and verified carbon impact for India's blue-carbon
              ecosystems.
            </p>
            <p className="mt-4 text-xs text-navy-foreground/60">
              Demonstration prototype built for the Ministry of Earth Sciences problem statement. Data shown is
              demonstration data and does not represent official government records. This system does not issue
              carbon credits.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-navy-foreground/60">Registry</p>
            <ul className="mt-3 space-y-2 text-sm text-navy-foreground/80">
              <li><Link to="/projects">Verified Projects</Link></li>
              <li><Link to="/map">Coastal Map</Link></li>
              <li><Link to="/how-it-works">How It Works</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-navy-foreground/60">Access</p>
            <ul className="mt-3 space-y-2 text-sm text-navy-foreground/80">
              <li><Link to="/auth">Project Owner Sign In</Link></li>
              <li><Link to="/auth">NCCR Verifier Sign In</Link></li>
              <li><Link to="/verify">Verify a Project</Link></li>
              <li><Link to="/about">About & Roadmap</Link></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
