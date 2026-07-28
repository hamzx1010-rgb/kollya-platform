/**
 * lang_audit.mjs — walk every route in a REAL browser, in EN and AR,
 * and report user-visible French that never went through t().
 *
 * The jsdom suites could not catch this: they assert on i18n KEYS, and
 * a hardcoded French literal has no key to be missing.
 */
import { openApp } from './harness.mjs';

const ROUTES = ['feed', 'explore', 'messages', 'notifications', 'hub',
                'channels', 'events', 'qa', 'saved', 'settings', 'leaderboard', 'profile'];

// words that are French-only and can never be a proper noun / faculty name
const FR = /\b(Envoyer|Enregistrer|Rechercher|Écrivez|Annuler|Fermer|Retour|Plus|Lire|Vitesse|Retirer|Position|Infos sur|Message vocal|Ajouter|Modifier|Supprimer|Publier|Charg\w+|Aucun\w*|Voir|Partager|Répondre|Signaler|Bloquer|Suivre|Abonn\w+|Param\w+|Aujourd|Hier|Demain|Semaine|hier|vous|votre|Vous|Votre|Nouveau|Nouvelle|Tous|Toutes|Épingl\w+|Non lus|Archiv\w+|Muet|brouillon|Brouillon|Écrit|Réagir|Transf\w+|Copier|Coller|Sélection\w*|Terminé|Suivant|Précédent|Confirmer|Accepter|Refuser|Demande\w*|Discussion\w*|Conversation\w*|Publication\w*|Commentaire\w*|Abonnés|Abonnements|Modifier le profil|Se déconnecter|Connexion|Inscription)\b/g;

const app = await openApp({ width: 1280, height: 900 });
const { page } = app;

const findings = [];

for (const r of ROUTES) {
  await page.evaluate(h => { location.hash = '#/' + h; }, r);
  await new Promise(res => setTimeout(res, 1100));

  // The composer only exists once a thread is open, so a route-level
  // sweep never saw it — that is how "Écrivez un message…" survived
  // the first audit. Open a conversation and the info panel too.
  if (r === 'messages') {
    await page.evaluate(() => document.querySelector('.dm-list-scroll .conv')?.click());
    await new Promise(res => setTimeout(res, 1200));
    await page.evaluate(() => document.getElementById('threadHead')?.click());
    await new Promise(res => setTimeout(res, 800));
  }

  const hit = await page.evaluate(frSrc => {
    const FR = new RegExp(frSrc, 'g');
    const out = [];
    const push = (where, txt) => {
      const m = String(txt || '').match(FR);
      if (m) out.push({ where, txt: String(txt).slice(0, 60), words: [...new Set(m)] });
    };
    // visible text nodes
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = n.textContent.trim();
      if (!t || t.length < 3) continue;
      const el = n.parentElement;
      if (!el || !el.getBoundingClientRect().width) continue;
      push('text:' + el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0], t);
    }
    // attributes the user actually sees or hears
    for (const el of document.querySelectorAll('[aria-label],[placeholder],[title],[data-tip]')) {
      for (const a of ['aria-label', 'placeholder', 'title', 'data-tip']) {
        const v = el.getAttribute(a);
        if (v) push(`${a}:${el.tagName.toLowerCase()}#${el.id || ''}.${String(el.className).split(' ')[0]}`, v);
      }
    }
    return out;
  }, FR.source);

  for (const h of hit) findings.push({ route: r, ...h });
}

/* dedupe */
const seen = new Map();
for (const f of findings) {
  const k = f.where + '|' + f.txt;
  if (!seen.has(k)) seen.set(k, f);
}
const list = [...seen.values()];

console.log(`\nFrench leaks while UI language = EN: ${list.length}\n`);
const byRoute = {};
for (const f of list) (byRoute[f.route] ||= []).push(f);
for (const [r, fs] of Object.entries(byRoute)) {
  console.log(`  #/${r}  (${fs.length})`);
  for (const f of fs.slice(0, 12)) console.log(`     ${f.where}  →  "${f.txt}"`);
}

await app.close();
console.log(`\nTOTAL ${list.length}`);
