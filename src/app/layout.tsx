import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Khmer Word Breaker — TipTap Extension",
  description: "A TipTap extension that inserts zero-width spaces at Khmer word boundaries for proper line wrapping, word selection, and text processing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@300;400;500;600;700&family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="antialiased"
        style={{
          fontFamily: '"DM Sans", sans-serif',
          backgroundColor: '#fafaf8',
          color: '#1a1a2e',
        }}
      >
        {children}
      </body>
    </html>
  );
}
