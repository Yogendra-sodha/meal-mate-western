import { useState, type ReactNode } from "react";
import { ChefHat, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-5 py-10">
      <div className="mb-6 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary-container text-primary-container-foreground">
          <ChefHat className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="surface-card p-5">{children}</div>
    </div>
  );
}

function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      toast.error("Enter your email and password");
      return;
    }
    setBusy(true);
    try {
      if (mode === "up") {
        await signUp(name.trim() || email.split("@")[0]!, email.trim(), password);
        toast.success("Account created — you can sign in now");
        setMode("in");
      } else {
        await signIn(email.trim(), password);
      }
    } catch (error) {
      toast.error(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Bachelor Dinner Planner"
      subtitle="Plan dinner, groceries and kitchen tasks together"
    >
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
        {(["in", "up"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-full py-2 text-sm font-bold",
              mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {m === "in" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {mode === "up" ? (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            className="h-12"
          />
        ) : null}
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
          className="h-12"
        />
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete={mode === "up" ? "new-password" : "current-password"}
          className="h-12"
        />
        <Button type="submit" disabled={busy} className="mt-2 h-12 w-full rounded-full">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {mode === "in" ? "Sign in" : "Create account"}
        </Button>
      </form>
    </Shell>
  );
}

function HouseholdScreen() {
  const { createHousehold, joinHousehold, signOut, user } = useAuth();
  const [householdName, setHouseholdName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      toast.error(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Join your household" subtitle={`Signed in as ${user?.email ?? ""}`}>
      <h2 className="font-bold">Have an invite code?</h2>
      <div className="mt-2 flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABC123"
          className="h-12 tracking-[0.2em]"
        />
        <Button
          disabled={busy || !code.trim()}
          className="h-12 shrink-0 rounded-full"
          onClick={() => void run(() => joinHousehold(code.trim()))}
        >
          Join
        </Button>
      </div>

      <div className="my-5 flex items-center gap-3 text-xs font-bold text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> OR <span className="h-px flex-1 bg-border" />
      </div>

      <h2 className="font-bold">Start a new household</h2>
      <Input
        value={householdName}
        onChange={(e) => setHouseholdName(e.target.value)}
        placeholder="e.g. Flat 402 Bachelors"
        className="mt-2 h-12"
      />
      <Button
        variant="secondary"
        disabled={busy || !householdName.trim()}
        className="mt-2 h-12 w-full rounded-full"
        onClick={() => void run(() => createHousehold(householdName.trim()))}
      >
        Create household
      </Button>

      <Button
        variant="ghost"
        className="mt-4 h-11 w-full rounded-full text-muted-foreground"
        onClick={() => void signOut()}
      >
        Sign out
      </Button>
    </Shell>
  );
}

/**
 * Supabase's raw auth errors are easy to misread — "email rate limit exceeded"
 * is about the confirmation mailer, not the number of accounts allowed.
 */
function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/email rate limit|rate limit exceeded/i.test(message)) {
    return "Too many confirmation emails were sent in a short time. Wait an hour and try again, or ask the household owner to turn off email confirmation.";
  }
  if (/already registered|already been registered/i.test(message)) {
    return "That email already has an account — try signing in instead.";
  }
  return message || "Something went wrong";
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, householdLoaded, session, household } = useAuth();

  if (loading || (session && !householdLoaded)) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) return <SignInScreen />;
  if (!household) return <HouseholdScreen />;
  return <>{children}</>;
}
