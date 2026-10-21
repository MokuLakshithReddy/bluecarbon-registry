import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Waves } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign In · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Sign in as a project owner or NCCR verifier to register blue-carbon restoration projects and verify field evidence.",
      },
      { property: "og:title", content: "Sign In · BlueCarbon MRV Registry" },
      {
        property: "og:description",
        content: "Role-based access for project owners and NCCR government verifiers.",
      },
    ],
  }),
  component: AuthPage,
});

// Security hardening: Demo credentials are strictly forbidden in production builds.
// Demo mode is only accessible in local development when VITE_ALLOW_DEMO_LOGIN="true".
const isDemoModeEnabled =
  Boolean(import.meta.env.DEV) && import.meta.env["VITE_ALLOW_DEMO_LOGIN"] === "true";
const DEMO_PASSWORD = isDemoModeEnabled ? (import.meta.env["VITE_DEMO_PASSWORD"] ?? "") : "";

function AuthPage() {
  const navigate = useNavigate();
  const { session, isVerifier, loading } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && session) {
      void navigate({ to: isVerifier ? "/verifier" : "/dashboard" });
    }
  }, [loading, session, isVerifier, navigate]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  };

  const demoLogin = async (email: string) => {
    if (!isDemoModeEnabled || !DEMO_PASSWORD) {
      toast.error("Demo login is disabled in this environment.");
      return;
    }
    setBusy(email);
    try {
      await signIn(email, DEMO_PASSWORD);
      toast.success(`Signed in as ${email}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `${error.message}. (Ensure demo accounts are seeded via admin script)`
          : "Demo sign-in failed",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-gradient-deep p-10 text-navy-foreground lg:flex">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-white/15">
            <Waves className="size-4.5" />
          </span>
          <span className="font-display text-sm font-semibold">BlueCarbon MRV Registry</span>
        </Link>
        <div className="max-w-md">
          <h2 className="font-display text-3xl font-semibold leading-tight">
            Capture → Validate → Verify → Record → Prove
          </h2>
          <p className="mt-4 text-sm text-navy-foreground/80">
            A trusted digital MRV and registry system connecting field evidence, automated
            validation, human NCCR verification, tamper-evident records and verified carbon impact.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-navy-foreground/80">
            <li>· Role-based access for project owners and government verifiers</li>
            <li>· Evidence quality scoring and automated anomaly screening</li>
            <li>· Verified Carbon Impact in tCO₂e — no carbon credits are issued</li>
          </ul>
        </div>
        <p className="text-xs text-navy-foreground/60">
          Demonstration prototype · Ministry of Earth Sciences problem statement
        </p>
      </div>

      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-6 lg:hidden">
            <Link to="/" className="font-display text-lg font-semibold">
              BlueCarbon MRV Registry
            </Link>
          </div>
          <h1 className="font-display text-2xl font-semibold">Registry access</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Project owners register and monitor projects. NCCR verifiers review and verify
            submissions. Public verification needs no login.
          </p>

          {isDemoModeEnabled && (
            <div className="panel mt-6 space-y-3 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Demo accounts
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => demoLogin("owner@bluecarbon.demo")}
                  className="justify-start"
                >
                  {busy === "owner@bluecarbon.demo" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Waves className="size-4" />
                  )}
                  Project Owner
                </Button>
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => demoLogin("verifier@nccr.demo")}
                  className="justify-start"
                >
                  {busy === "verifier@nccr.demo" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-4" />
                  )}
                  NCCR Verifier
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                owner@bluecarbon.demo / verifier@nccr.demo · password{" "}
                <span className="mono-hash">{DEMO_PASSWORD}</span>
              </p>
            </div>
          )}

          <Tabs defaultValue="signin" className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <SignInForm onSubmit={signIn} />
            </TabsContent>
            <TabsContent value="signup">
              <SignUpForm />
            </TabsContent>
          </Tabs>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            <Link to="/verify" className="font-semibold text-primary">
              Verify a project publicly
            </Link>{" "}
            — no account required.
          </p>
        </div>
      </div>
    </div>
  );
}

function SignInForm({
  onSubmit,
}: {
  onSubmit: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSubmit(email.trim(), password);
          toast.success("Signed in successfully.");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Sign-in failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="signin-email">Email</Label>
        <Input
          id="signin-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="signin-password">Password</Label>
        <Input
          id="signin-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : null} Sign in
      </Button>
    </form>
  );
}

function SignUpForm() {
  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    organization: "",
    phone: "",
  });
  const [busy, setBusy] = useState(false);
  const update = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          const { error } = await supabase.auth.signUp({
            email: form.email.trim(),
            password: form.password,
            options: {
              emailRedirectTo: window.location.origin,
              data: {
                full_name: form.full_name,
                organization: form.organization,
                phone: form.phone,
              },
            },
          });
          if (error) throw new Error(error.message);
          toast.success("Account created. You are now signed in.");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Sign-up failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="su-email">Email</Label>
          <Input
            id="su-email"
            type="email"
            required
            value={form.email}
            onChange={(event) => update("email", event.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="su-password">Password</Label>
          <Input
            id="su-password"
            type="password"
            required
            minLength={6}
            value={form.password}
            onChange={(event) => update("password", event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="su-name">Full name</Label>
          <Input
            id="su-name"
            value={form.full_name}
            onChange={(event) => update("full_name", event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="su-org">Organization</Label>
          <Input
            id="su-org"
            value={form.organization}
            onChange={(event) => update("organization", event.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="su-phone">Contact phone</Label>
          <Input
            id="su-phone"
            value={form.phone}
            onChange={(event) => update("phone", event.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        New accounts are created with the Project Owner role. NCCR verifier access is granted by a
        registry administrator.
      </p>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : null} Create account
      </Button>
    </form>
  );
}
