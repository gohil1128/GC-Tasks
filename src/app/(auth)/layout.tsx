/*
  The signed-out pages: sign in, first-run setup and choosing a password. No
  header or nav — there is nowhere else to go from here yet.
*/
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background">{children}</div>;
}
