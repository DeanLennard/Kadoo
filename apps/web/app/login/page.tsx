// apps/web/app/login/page.tsx
"use client";
import { signIn } from "next-auth/react";

export default function Login() {
    return (
        <main style={{ padding: 24, maxWidth: 420 }}>
            <h1>Sign in to Kadoo</h1>
            <p style={{ opacity: 0.8, marginBottom: 12 }}>
                Choose a provider. We’ll return you where you left off.
            </p>

            <button onClick={() => signIn("google")} style={{ display: "block", marginBottom: 8 }}>
                Continue with Google
            </button>

            <button onClick={() => signIn("azure-ad")} style={{ display: "block", marginBottom: 8 }}>
                Continue with Microsoft
            </button>

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    const email = new FormData(e.currentTarget).get("email") as string;
                    signIn("email", { email }); // NextAuth will include ?callbackUrl=<from middleware>
                }}
            >
                <input name="email" type="email" placeholder="you@company.com" required />
                <button type="submit">Send magic link</button>
            </form>
        </main>
    );
}
