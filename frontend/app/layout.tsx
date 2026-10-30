import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UK Stat Agent — ONS statistical insights & X/social publishing",
  description:
    "Ask questions about UK statistics to pull official data from the Office for National Statistics (ONS) via MCP, generate easy-to-read graphs/visuals, and draft approved posts for X/Twitter and LinkedIn. Powered by Google ADK, AG-UI and CopilotKit.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${roboto.variable} ${robotoMono.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
