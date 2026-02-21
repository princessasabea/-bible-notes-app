import { signIn, signOut } from "@/auth";

export function SignInOutButton({ email }: { email: string | null }): React.ReactElement {
  return email ? (
    <form
      className="auth-form"
      action={async () => {
        "use server";
        await signOut();
      }}
    >
      <span className="signed-in-email">{email}</span>
      <button type="submit" className="ghost-button">Sign out</button>
    </form>
  ) : (
    <form
      action={async () => {
        "use server";
        await signIn();
      }}
    >
      <button type="submit">Sign in</button>
    </form>
  );
}
