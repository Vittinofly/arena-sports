// Monta a pasta "publico/" só com o que vai para o ar. A Vercel roda este arquivo a cada deploy
// (vercel.json) e publica apenas essa pasta: ficha.md, README.md, design/, supabase/, tests/
// e as fotos originais ficam fora do site.
// Na raiz entram as páginas e os arquivos de SEO (.html, .css, .js, .txt, .xml, .webmanifest...),
// então um arquivo de verificação do Google (googleXXXX.html) colocado na raiz também sobe.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));
const destino = join(raiz, 'publico');
const extensoesDaRaiz = new Set(['.html', '.css', '.js', '.txt', '.xml', '.webmanifest', '.ico', '.png', '.svg']);
const pastas = ['js', 'fonts', 'img'];
const foraDoSite = [join('img', 'originais')];

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino);

let total = 0;
for (const nome of readdirSync(raiz)) {
  const origem = join(raiz, nome);
  if (nome.startsWith('.') || !statSync(origem).isFile() || !extensoesDaRaiz.has(extname(nome))) continue;
  cpSync(origem, join(destino, nome));
  total++;
}

for (const pasta of pastas) {
  cpSync(join(raiz, pasta), join(destino, pasta), {
    recursive: true,
    filter: (origem) => {
      const rel = relative(raiz, origem);
      const fora = foraDoSite.some((p) => rel === p || rel.startsWith(p + sep));
      if (!fora && statSync(origem).isFile()) total++;
      return !fora;
    },
  });
}

for (const obrigatorio of ['index.html', 'agendar.html', 'reserva.html', 'admin.html', 'sw.js', 'manifest.webmanifest']) {
  if (!existsSync(join(destino, obrigatorio))) {
    console.error(`Faltou ${obrigatorio} na pasta publico/`);
    process.exit(1);
  }
}
console.log(`publico/ pronta com ${total} arquivos`);
