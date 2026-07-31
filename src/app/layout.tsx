import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeetFlow AI Recorder",
  description: "Ghi âm, tải audio, chuyển giọng nói thành transcript và tóm tắt cuộc họp.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
