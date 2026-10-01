import { useState, type ReactNode } from "react";
import { ChefHat, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { authRedirect } from "@/lib/auth-redirect";
import { cn } from "@/lib/utils";

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
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

/** Shortest password this will send; Supabase's own floor is lower. */
const MIN_PASSWORD = 8;

/**
 * Asks for the address to send a recovery link to.
 *
 * It reports the same thing whether or not that address has an account, because
 * saying "no account with that email" would turn the form into a way of finding
 * out who is in the house. Supabase answers the same way for the same reason.
 */
function ForgotPasswordScreen({
  onBack,
  initialEmail,
}: {
  onBack: () => void;
  initialEmail: string;
}) {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!email.trim()) {
      toast.error("Enter your email");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordReset(email.trim());
      setSent(true);
    } catch (error) {
      toast.error(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Shell title="Check your email" subtitle={email.trim()}>
        <p className="text-sm text-muted-foreground">
          If there is an account for that address, a link to set a new password is on its way. The
          link works once and expires after an hour.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing arrived? Check spam, then try again in a few minutes — the mailer only allows a
          few in a row.
        </p>
        <Button variant="secondary" className="mt-4 h-12 w-full rounded-full" onClick={onBack}>
          Back to sign in
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title="Forgotten password" subtitle="We will email you a link to set a new one">
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
          className="h-12"
        />
        <Button type="submit" disabled={busy} className="mt-2 h-12 w-full rounded-full">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Send the link
        </Button>
      </form>
      <Button
        variant="ghost"
        className="mt-3 h-11 w-full rounded-full text-muted-foreground"
        onClick={onBack}
      >
        Back to sign in
      </Button>
    </Shell>
  );
}

/**
 * Where a recovery link lands: the one screen that sets a new password.
 *
 * The link signs the person in on arrival, which is what makes the change
 * possible — and also why this has to come before the rest of the app. Landing
 * straight on the menu would leave them signed in with the password they could
 * not remember, locked out again at the next sign-out.
 */
function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const { setPassword, session, signOut } = useAuth();
  const [first, setFirst] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);

  // No session means the link was already used, or has expired. Supabase sends
  // an error fragment for most of those, but not all, so this is the backstop.
  if (!session) {
    return (
      <Shell title="That link has expired" subtitle="Recovery links work once, within the hour">
        <p className="text-sm text-muted-foreground">
          Ask for a fresh one from the sign-in screen and open it on this device.
        </p>
        <Button className="mt-4 h-12 w-full rounded-full" onClick={onDone}>
          Back to sign in
        </Button>
      </Shell>
    );
  }

  const submit = async () => {
    if (first.length < MIN_PASSWORD) {
      toast.error(`Use at least ${MIN_PASSWORD} characters`);
      return;
    }
    if (first !== again) {
      toast.error("The two passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await setPassword(first);
      toast.success("Password changed — you are signed in");
      onDone();
    } catch (error) {
      toast.error(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Set a new password" subtitle={session.user.email ?? ""}>
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          type="password"
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          placeholder="New password"
          autoComplete="new-password"
          className="h-12"
        />
        <Input
          type="password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          placeholder="New password again"
          autoComplete="new-password"
          className="h-12"
        />
        <p className="text-xs text-muted-foreground">
          At least {MIN_PASSWORD} characters. You will stay signed in on this device.
        </p>
        <Button type="submit" disabled={busy} className="mt-2 h-12 w-full rounded-full">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save password
        </Button>
      </form>
      <Button
        variant="ghost"
        className="mt-3 h-11 w-full rounded-full text-muted-foreground"
        onClick={() => void signOut()}
      >
        Cancel and sign out
      </Button>
    </Shell>
  );
}

function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  if (forgot) return <ForgotPasswordScreen onBack={() => setForgot(false)} initialEmail={email} />;

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

      {mode === "in" ? (
        <button
          type="button"
          onClick={() => setForgot(true)}
          className="mt-3 w-full py-2 text-sm font-semibold text-primary"
        >
          Forgotten your password?
        </button>
      ) : null}
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
  if (/password should be at least|password.*too short|weak password/i.test(message)) {
    return `That password is too short — use at least ${MIN_PASSWORD} characters.`;
  }
  if (/same.*password|different from the old/i.test(message)) {
    return "That is the password you already have — pick a different one.";
  }
  if (/auth session missing|session.*not found/i.test(message)) {
    return "That link has expired. Ask for a fresh one from the sign-in screen.";
  }
  return message || "Something went wrong";
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, householdLoaded, session, household } = useAuth();
  // Read once, from the snapshot taken before supabase-js wiped the fragment.
  // Setting a password clears this, so the app opens normally afterwards
  // without the link having to be visited again.
  const [recovering, setRecovering] = useState(authRedirect?.kind === "recovery");

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // Ahead of the household check: someone arriving to fix their password should
  // not be asked for an invite code first.
  if (recovering) return <NewPasswordScreen onDone={() => setRecovering(false)} />;
  if (session && !householdLoaded) {
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
