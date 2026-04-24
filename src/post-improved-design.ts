import { config } from "dotenv";
config();

const token = process.env.FIGMA_ACCESS_TOKEN;
const fileKey = "yz0BpjMAlOUmx35wFnQWvo";
const nodeId = "305:185";

async function postImprovedDesign() {
  const images = await fetch(
    `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=1`,
    { headers: { "X-Figma-Token": token! } }
  ).then((r) => r.json());
  const imageUrl = images.images?.[nodeId];

  const code = `## 🎨 Improved moikas.com Landing Page

\`\`\`tsx
import { ShoppingBag, ArrowRight } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white antialiased">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <span className="text-xl font-bold tracking-tight">moikas.com</span>
          <div className="flex items-center gap-6 text-sm font-medium text-white/70">
            <a href="#shop" className="hover:text-white transition-colors">Shop</a>
            <a href="#about" className="hover:text-white transition-colors">About</a>
            <a href="#contact" className="hover:text-white transition-colors">Contact</a>
            <button className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90">
              <ShoppingBag className="mr-1 inline h-3 w-3" />
              Cart
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative mx-auto max-w-7xl px-6 py-20">
        <div className="relative overflow-hidden rounded-3xl shadow-2xl shadow-black/40">
          <img
            src="${imageUrl}"
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
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="grid gap-6 md:grid-cols-3">
          {["Free Shipping", "Handmade Quality", "Sustainable"].map((t) => (
            <div key={t} className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center backdrop-blur-sm">
              <h3 className="font-bold">{t}</h3>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
\`\`\`

**Improvements:**
- Sticky glassmorphism navbar
- Hero gradient overlay + bottom-aligned text
- CTA with arrow icon + scale hover
- 3-column feature cards
- Responsive max-width container (max-w-7xl)
- Lucide icons (ShoppingBag, ArrowRight)`;

  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
    method: "POST",
    headers: { "X-Figma-Token": token!, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: code,
      client_meta: { node_id: nodeId, node_offset: { x: 0, y: 0 } },
    }),
  }).then((r) => r.json());
  console.log("Posted improved design comment:", res.id);
}

postImprovedDesign().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
