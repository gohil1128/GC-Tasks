"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { requestSignupAction, type AuthFormState } from "@/modules/auth/actions";
import { authInputClass, Field, FormError, PasswordInput, SubmitButton } from "./form-bits";

/** Step one of sign-up: who you are and the password you want. Success moves on to the code page. */
export function SignupForm() {
  const [state, formAction] = React.useActionState(requestSignupAction, null as AuthFormState);

  return (
    <form action={formAction} className="grid gap-4">
      <Field id="name" label="Your name" hint="As the team knows you — it shows on the tasks you're on.">
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          maxLength={80}
          defaultValue={state?.values?.name}
          aria-describedby="name-hint"
          className={authInputClass}
        />
      </Field>
      <Field id="email" label="Email" hint="We'll email a code here, and it's what you'll sign in with.">
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
      <SubmitButton label="Email me a code" pendingLabel="Sending…" />
    </form>
  );
}
