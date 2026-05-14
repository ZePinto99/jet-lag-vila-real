export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col gap-8 px-6 py-16">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Jet Lag: Vila Real</h1>
        <p className="text-sm text-neutral-400">Walking-only capture the flag. The app is the referee.</p>
      </header>
      <div className="flex flex-col gap-4">
        <a
          href="/game/new"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-5 py-5 text-center transition hover:border-neutral-500 hover:bg-neutral-800"
        >
          <div className="text-lg font-medium">Create game</div>
          <div className="mt-1 text-sm text-neutral-400">Start a new session and invite your team</div>
        </a>
        <a
          href="/game/join"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-5 py-5 text-center transition hover:border-neutral-500 hover:bg-neutral-800"
        >
          <div className="text-lg font-medium">Join game</div>
          <div className="mt-1 text-sm text-neutral-400">Enter a 4-letter code to join an existing session</div>
        </a>
      </div>
    </main>
  )
}
