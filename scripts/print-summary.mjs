const BASE = process.env.ASI_BASE ?? 'http://localhost:8787';
const eps = await fetch(`${BASE}/api/episodes?personId=local`).then((r) => r.json());
for (const ep of eps) {
  const t = await fetch(`${BASE}/api/episodes/${ep.id}/summary.txt`).then((r) => r.text());
  console.log('='.repeat(72));
  console.log(t);
  console.log();
}
