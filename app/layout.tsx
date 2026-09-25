import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Webhook Delivery — Integrações', description: 'Receba e acompanhe seus eventos em um só lugar.', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
