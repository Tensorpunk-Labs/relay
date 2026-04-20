import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./relay-skin.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Relay Core",
  description: "Context flow visualization for human-agent teams",
};

// Lightning CSS (Tailwind v4) strips unprefixed `backdrop-filter` from
// our CSS files and only emits the `-webkit-` form, which modern Chrome
// no longer recognizes. Inject the rules via a raw <style> tag so they
// bypass the CSS pipeline entirely.
const backdropFilterFix = `
.rs-liquid-glass {
  backdrop-filter: blur(28px) saturate(150%);
  -webkit-backdrop-filter: blur(28px) saturate(150%);
}
.rs-liquid-glass-row {
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <style dangerouslySetInnerHTML={{ __html: backdropFilterFix }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
