import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Amigo Refrigerista Pro',
  description: 'Ferramenta de aministração para técnicos de Refrigeração e Climatização.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body suppressHydrationWarning className="bg-[#f7f9fb] text-[#191c1e] font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
