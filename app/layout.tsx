import type { Metadata } from "next";
import { Prompt } from "next/font/google";
import "./globals.css";

const prompt = Prompt({
  variable: "--font-prompt",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "ก๊วน CS KhemKhang",
  description: "ระบบจับคู่ตีแบดมินตันและจับเวลา ก๊วน CS KhemKhang",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className="h-full antialiased">
      <body className={`${prompt.variable} min-h-full flex flex-col`}>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("kuanbad-theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark")}}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}