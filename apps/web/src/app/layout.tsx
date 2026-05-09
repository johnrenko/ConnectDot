import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "ConnectDot",
  description: "Turn images into printable dot-to-dot worksheets"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
