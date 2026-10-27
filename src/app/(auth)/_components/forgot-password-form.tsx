"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { requestResetCodeAction, type AuthFormState } from "@/modules/auth/actions";
import { authInputClass, Field, FormError, SubmitButton } from "./form-bits";

/** Step one of "Forgot password?": just the address. Success moves on to the code page. */
export function ForgotPasswordForm() {
  const [state, formAction] = React.useActionState(requestResetCodeAction, null as AuthFormState);

  return (
    <form action={formAction} className="grid gap-4">
      <Field id="email" label="Email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state?.values?.email}
          placeholder="you@example.com"
          className={authInputClass}
        />
      </Field>
      <FormError message={state?.error} />
      <SubmitButton label="Email me a code" pendingLabel="Sending…" />
    </form>
  );
}
