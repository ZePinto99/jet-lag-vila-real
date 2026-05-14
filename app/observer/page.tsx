import Link from 'next/link'

export default function ObserverPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
        &larr; Back
      </Link>
      <h1 className="text-2xl font-semibold">Observer view</h1>
      <p className="text-neutral-400">Coming soon.</p>
    </main>
  )
}
