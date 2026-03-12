import type { Metadata } from 'next';
import './globals.css';
import AuthGate from '@/components/AuthGate';

export const metadata: Metadata = {
  title: 'Forge AI',
  description: 'Autonomous multi-agent software factory',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en">
      <body className="bg-[#0a0a0f] text-white antialiased">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
