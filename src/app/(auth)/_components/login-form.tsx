"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { loginAction, type AuthFormState } from "@/modules/auth/actions";
import { authInputClass, Field, FormError, PasswordInput, SubmitButton } from "./form-bits";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = React.useActionState(loginAction, null as AuthFormState);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
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
          // React resets a form after its action runs; this puts the address
          // back so a mistyped password does not cost the email too.
          defaultValue={state?.values?.email}
          placeholder="you@example.com"
          className={authInputClass}
        />
      </Field>
      <Field id="password" label="Password">
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </Field>
      <FormError message={state?.error} />
      <SubmitButton label="Sign in" pendingLabel="Signing in…" />
    </form>
  );
}
