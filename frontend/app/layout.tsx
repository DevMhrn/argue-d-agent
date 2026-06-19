import type { Metadata } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { AppChrome } from "../components/AppChrome";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
// "The artifact" face — ledger quotes, case title, demand letter.
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Lumen — Subrogation Recovery Workbench",
  description:
    "AI subrogation recovery — investigates a claim, argues both sides over a locked evidence ledger, and produces a ready-to-send recovery packet.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} antialiased`}
    >
      <body className="flex min-h-screen flex-col font-sans text-text">
        <AppChrome />
        <main className="flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
