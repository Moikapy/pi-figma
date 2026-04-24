export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white antialiased">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <span className="text-xl font-bold tracking-tight">moikas.com</span>
          <div className="flex items-center gap-6 text-sm font-medium text-white/70">
            <a href="#shop" className="transition-colors hover:text-white">Shop</a>
            <a href="#about" className="transition-colors hover:text-white">About</a>
            <a href="#contact" className="transition-colors hover:text-white">Contact</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative mx-auto max-w-7xl px-6 py-20">
        <div className="relative overflow-hidden rounded-3xl shadow-2xl shadow-black/40">
          <img
            src="/hero.png"
            alt="moikas hero"
            className="h-[560px] w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-12">
            <h1 className="text-5xl font-extrabold tracking-tight drop-shadow-lg">
              Handcrafted Design
            </h1>
            <p className="mt-3 max-w-lg text-lg text-white/80 drop-shadow">
              Unique pieces for unique people. Every item tells a story.
            </p>
            <button className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-bold text-black transition-transform hover:scale-105 hover:bg-white/95 active:scale-95">
              Explore Collection
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
