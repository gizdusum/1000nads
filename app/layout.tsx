import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import './globals.css'

const ClientProviders = dynamic(() => import('@/app/providers').then((mod) => mod.Providers), {
  ssr: false,
})

export const metadata: Metadata = {
  title: '1000Nads — Be immortal on Monad. Forever.',
  description: 'Own one of 1000 permanent spots on Monad.',
  icons: { icon: '/favicon.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  )
}
