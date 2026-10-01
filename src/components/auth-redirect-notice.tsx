import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { authRedirect } from "@/lib/auth-redirect";

/**
 * Announces the outcome of an email confirmation link. Without this the user
 * lands back on the app with no indication that anything happened, even though
 * the address was verified.
 */
export function AuthRedirectNotice() {
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current || !authRedirect) return;
    shown.current = true;

    if (authRedirect.kind === "error") {
      toast.error(authRedirect.message, { duration: 8000 });
      return;
    }

    // A recovery link gets a screen asking for the new password, so saying
    // anything here would only talk over it.
    if (authRedirect.kind === "recovery") return;

    toast.success(
      authRedirect.type === "email_change"
        ? "Email address confirmed"
        : "Email confirmed — you're signed in",
      { duration: 6000 },
    );
  }, []);

  return null;
}
