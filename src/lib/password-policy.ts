/*
  The rule for choosing a new password, in a file with no server-only imports
  so a form can state it without pulling bcrypt into the browser bundle.
  Sign-in itself does not apply it — that would lock out anyone whose
  password predates the rule.
*/
export const MIN_PASSWORD_LENGTH = 8;
