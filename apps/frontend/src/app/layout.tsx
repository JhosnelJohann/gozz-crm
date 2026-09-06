import type { Metadata } from "next";
import { Inter, Oswald, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/magic/ThemeProvider";
import { LenisProvider } from "@/components/magic/LenisProvider";
import { CallProvider } from "@/components/videollamada/CallProvider";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-inter",
  display: "swap"
});

const oswald = Oswald({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-oswald",
  display: "swap"
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space",
  display: "swap"
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap"
});

export const metadata: Metadata = {
  title: "GOZZ CRM",
  description: "GOZZ — CRM AI-first para agencias de inmigración",
  icons: { icon: ["/logo-gozz.svg", "/logo-gozz.png"], apple: "/logo-gozz.png" }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${oswald.variable} ${spaceGrotesk.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        {/* Claro es el default (rediseño 2026); solo se activa oscuro si el usuario lo eligió
            explícitamente antes (toggle en Topbar). Ya no se decide por hora del día — evita
            además el flash oscuro→claro que había en horario nocturno, porque ThemeProvider
            ya defaultaba a claro al hidratar y este script decidía distinto hasta ese momento. */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              if (localStorage.getItem('theme') === 'dark') {
                document.documentElement.classList.add('dark');
              }
            } catch(e){}
          })();
        `}} />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider>
          <LenisProvider>
            <CallProvider>
              {children}
            </CallProvider>
          </LenisProvider>
        </ThemeProvider>
        <Toaster position="top-right" richColors closeButton theme="system" />
      </body>
    </html>
  );
}
