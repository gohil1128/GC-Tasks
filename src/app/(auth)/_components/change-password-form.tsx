"use client";
import * as React from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { changePasswordAction, type AuthFormState } from "@/modules/auth/actions";
import { Field, FormError, PasswordInput, SubmitButton } from "./form-bits";

export function ChangePasswordForm({ forced, email }: { forced: boolean; email: string }) {
  const [state, formAction] = React.useActionState(changePasswordAction, null as AuthFormState);

  return (
    <form action={formAction} className="grid gap-4">
      {/* Lets a password manager file the new password under the right account. */}
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field id="currentPassword" label={forced ? "The password you were given" : "Current password"}>
        <PasswordInput id="currentPassword" name="currentPassword" autoComplete="current-password" required />
      </Field>
      <Field id="newPassword" label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
        <PasswordInput
          id="newPassword"
          name="newPassword"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          aria-describedby="newPassword-hint"
        />
      </Field>
      <Field id="confirmPassword" label="Repeat new password">
        <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required />
      </Field>
      <FormError message={state?.error} />
      <SubmitButton label={forced ? "Set my password" : "Change password"} pendingLabel="Saving…" />
    </form>
  );
}
