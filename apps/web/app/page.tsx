// apps/web/app/page.tsx (marketing or home)
import Link from "next/link";

export default function Home() {
    return (
        <main style={{ padding: 24 }}>
            <h1>Kadoo</h1>
            <p><a href="/api/auth/signin">Sign in</a></p>
            <p><Link href="/dashboard">Go to dashboard</Link></p>
        </main>
    );
}
