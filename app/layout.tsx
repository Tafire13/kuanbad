import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ก๊วน CS KhemKhang",
  description: "ระบบจับคู่ตีแบดมินตันและจับเวลา ก๊วน CS KhemKhang",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
