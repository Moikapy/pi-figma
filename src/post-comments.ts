import { config } from "dotenv";
config();

const token = process.env.FIGMA_ACCESS_TOKEN;
const fileKey = "yz0BpjMAlOUmx35wFnQWvo";
const nodeId = "305:185";

const suggestions = [
  {
    msg: "🎨 Design Review:\n\nConsider adding a headline text layer above the hero image. Something bold like your brand tagline.",
    y: 0,
  },
  {
    msg: "💬 CTA Button:\n\nAdd a primary CTA button (e.g., 'Shop Now') in a contrasting color below the headline.",
    y: 100,
  },
  {
    msg: "🧭 Navigation Bar:\n\nA top nav bar with logo + links (Shop, About, Contact) would improve discoverability.",
    y: -100,
  },
  {
    msg: "📐 Auto Layout:\n\nWrap the hero in a FRAME with Auto Layout (VERTICAL, centered, gap 24px) so it adapts responsively.",
    y: 200,
  },
];

async function postComments() {
  for (const s of suggestions) {
    const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
      method: "POST",
      headers: { "X-Figma-Token": token!, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: s.msg,
        client_meta: { node_id: nodeId, node_offset: { x: 0, y: Math.max(0, s.y) } },
      }),
    }).then((r) => r.json());
    console.log("Posted comment:", res.id);
  }
}

postComments().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
