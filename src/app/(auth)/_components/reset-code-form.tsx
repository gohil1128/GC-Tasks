"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { resetWithCodeAction, type AuthFormState } from "@/modules/auth/actions";
import { authInputClass, Field, FormError, PasswordInput, SubmitButton } from "./form-bits";

/*
  Step two: the code from the email and a new password. The address comes
  along from step one but stays editable, in case it was mistyped there.
*/
export function ResetCodeForm({ email }: { email: string }) {
  const [state, formAction] = React.useActionState(resetWithCodeAction, null as AuthFormState);

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
          defaultValue={state?.values?.email ?? email}
          className={authInputClass}
        />
      </Field>
      <Field id="code" label="6-digit code">
        <Input
          id="code"
          name="code"
          type="text"
          // The phone keypad, and iOS/Android offer the code straight from the email or SMS bar.
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          title="The 6 digits from the email"
          required
          autoFocus={Boolean(email)}
          placeholder="123456"
          className={`${authInputClass} tracking-[0.3em]`}
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
