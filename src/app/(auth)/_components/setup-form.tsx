"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { setupAction, type AuthFormState } from "@/modules/auth/actions";
import { authInputClass, Field, FormError, PasswordInput, SubmitButton } from "./form-bits";

export function SetupForm() {
  const [state, formAction] = React.useActionState(setupAction, null as AuthFormState);

  return (
    <form action={formAction} className="grid gap-4">
      <Field id="name" label="Your name">
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          maxLength={80}
          defaultValue={state?.values?.name}
          className={authInputClass}
        />
      </Field>
      <Field id="email" label="Email" hint="This is what you'll sign in with.">
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
          aria-describedby="email-hint"
          className={authInputClass}
        />
      </Field>
      <Field id="password" label="Password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          aria-describedby="password-hint"
        />
      </Field>
      <Field id="confirmPassword" label="Repeat password">
        <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required />
      </Field>
      <FormError message={state?.error} />
      <SubmitButton label="Create owner account" pendingLabel="Setting up…" />
    </form>
  );
}
