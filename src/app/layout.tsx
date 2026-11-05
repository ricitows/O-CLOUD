import type { Metadata } from 'next';
import './globals.css';
import './auth.css';
import './editorial.css';

export const metadata: Metadata = {
  title: 'O-CLOÜD',
  description: 'Closet y outfits.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}

