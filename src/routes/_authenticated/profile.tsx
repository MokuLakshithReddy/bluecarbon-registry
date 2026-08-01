import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "My Profile · BlueCarbon MRV Registry" },
      {
        name: "description",
        content:
          "Update your registry contact details so NCCR verifiers can reach you about your blue-carbon restoration submissions.",
      },
      { property: "og:title", content: "My Profile · BlueCarbon MRV Registry" },
      { property: "og:description", content: "Manage your registry contact details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, profile, roles, refresh } = useAuth();
  const [fullName, setFullName] = useState("");
  const [organization, setOrganization] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
    setOrganization(profile?.organization ?? "");
    setPhone(profile?.phone ?? "");
  }, [profile]);

  return (
    <AppShell title="My profile" description="These details appear on verification records you submit.">
      <form
        className="panel max-w-xl space-y-4 p-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!user) return;
          setBusy(true);
          const { error } = await supabase
            .from("profiles")
            .update({
              full_name: fullName.trim() || null,
              organization: organization.trim() || null,
              phone: phone.trim() || null,
            })
            .eq("id", user.id);
          setBusy(false);
          if (error) {
            toast.error(error.message);
            return;
          }
          await refresh();
          toast.success("Profile updated.");
        }}
      >
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input value={user?.email ?? ""} readOnly disabled />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="full-name">Full name</Label>
          <Input id="full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org">Organization</Label>
          <Input id="org" value={organization} onChange={(e) => setOrganization(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Contact phone</Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Registry roles</Label>
          <p className="text-sm text-muted-foreground">
            {roles.length > 0 ? roles.join(", ") : "project_owner"}
          </p>
        </div>
        <Button type="submit" disabled={busy}>
          Save changes
        </Button>
      </form>
    </AppShell>
  );
}
