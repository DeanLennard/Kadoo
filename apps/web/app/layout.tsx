import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kadoo",
  description: "Your AI Workforce",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
    return (
        <html lang="en">
        <body>
                <header className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur">
                    <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
                        <a href="/" className="font-semibold" style={{ color: "var(--kadoo-blue)" }}>
                            Kadoo
                        </a>
                        <nav className="text-sm">
                            <a className="mr-4 hover:underline" href="/dashboard">Dashboard</a>
                            <a className="mr-4 hover:underline" href="/inbox">Inbox</a>
                            <a className="mr-4 hover:underline" href="/calendar">Calendar</a>
                            <a className="hover:underline" href="/approvals">Approvals</a>
                            <a className="hover:underline" href="/employees">Employees</a>
                        </nav>
                    </div>
                </header>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
