"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { recoverAction, type AuthFormState } from "@/modules/auth/actions";
import { authInputClass, Field, FormError, PasswordInput, SubmitButton } from "./form-bits";

export function RecoverForm() {
  const [state, formAction] = React.useActionState(recoverAction, null as AuthFormState);

  return (
    <form action={formAction} className="grid gap-4">
      <Field id="key" label="Recovery key">
        <PasswordInput id="key" name="key" autoComplete="off" required />
      </Field>
      <Field id="email" label="Email of the account">
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
          className={authInputClass}
        />
      </Field>
      <Field id="password" label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          aria-describedby="password-hint"
        />
      </Field>
      <Field id="confirmPassword" label="Repeat new password">
        <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required />
      </Field>
      <FormError message={state?.error} />
      <SubmitButton label="Set password and sign in" pendingLabel="Setting password…" />
    </form>
  );
}
