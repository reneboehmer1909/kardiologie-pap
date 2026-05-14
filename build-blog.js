#!/usr/bin/env node
/**
 * Static Blog Generator for Dr. med. Thomas Pap
 * ───────────────────────────────────────────────
 * Fetches published posts from Contentful and generates:
 *   1.  blog/index.html          – listing page with all cards pre-rendered
 *   2.  blog/<slug>/index.html   – one file per post, full HTML + OG tags
 *
 * Run:   node build-blog.js
 * Trigger automatically via Contentful webhook → Netlify/Vercel rebuild.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

/* ============================================================
   Contentful config
   ============================================================ */
const CF = {
  spaceId:     process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN,
  contentType: 'drPap',
};

if (!CF.spaceId || !CF.accessToken) {
  console.error('❌ Fehler: CONTENTFUL_SPACE_ID und CONTENTFUL_ACCESS_TOKEN müssen als Environment Variables gesetzt sein.');
  console.error('   Lokal: CONTENTFUL_SPACE_ID=xxx CONTENTFUL_ACCESS_TOKEN=yyy node build-blog.js');
  console.error('   Netlify: Site configuration → Environment variables');
  process.exit(1);
}

const SITE_URL = process.env.SITE_URL || 'https://www.kardiologie-pap.at';

/* ============================================================
   Helpers
   ============================================================ */
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        resolve(JSON.parse(data));
      });
    }).on('error', reject);
  });
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-AT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function getOrtString(ortField) {
  if (!ortField) return '';
  if (typeof ortField === 'string') return ortField;
  return 'Graz';
}

/* ---- Text → HTML ---- */
function textToHtml(str) {
  if (!str) return '';
  return str.split(/\n\n+/).map(para => {
    const trimmed = para.trim();
    if (!trimmed) return '';
    return '<p>' + escapeHtml(trimmed).replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

function getBodyHtml(fields) {
  const raw = fields.inhalt || fields.text || '';
  if (typeof raw === 'string') return textToHtml(raw);
  if (raw.nodeType === 'document' && raw.content) return renderRichText(raw);
  return '';
}

function getBodyPlain(fields) {
  const raw = fields.inhalt || fields.text || '';
  if (typeof raw === 'string') return raw;
  if (raw.nodeType === 'document') return extractPlainText(raw);
  return '';
}

/* ---- Rich Text renderer ---- */
function renderRichText(doc) {
  if (!doc || !doc.content) return '';
  return doc.content.map(renderNode).join('');
}

function renderNode(node) {
  if (!node) return '';
  const c = () => (node.content || []).map(renderNode).join('');
  switch (node.nodeType) {
    case 'paragraph':      return '<p>' + c() + '</p>';
    case 'heading-2':      return '<h2>' + c() + '</h2>';
    case 'heading-3':      return '<h3>' + c() + '</h3>';
    case 'heading-4':      return '<h4>' + c() + '</h4>';
    case 'unordered-list': return '<ul>' + c() + '</ul>';
    case 'ordered-list':   return '<ol>' + c() + '</ol>';
    case 'list-item':      return '<li>' + c() + '</li>';
    case 'blockquote':     return '<blockquote>' + c() + '</blockquote>';
    case 'hr':             return '<hr>';
    case 'hyperlink':
      return `<a href="${(node.data && node.data.uri) || '#'}" target="_blank" rel="noopener">${c()}</a>`;
    case 'text': {
      let t = escapeHtml(node.value || '');
      (node.marks || []).forEach(m => {
        if (m.type === 'bold')      t = '<strong>' + t + '</strong>';
        if (m.type === 'italic')    t = '<em>' + t + '</em>';
        if (m.type === 'underline') t = '<u>' + t + '</u>';
        if (m.type === 'code')      t = '<code>' + t + '</code>';
      });
      return t;
    }
    default: return c();
  }
}

function extractPlainText(doc) {
  if (!doc || !doc.content) return '';
  let text = '';
  (function walk(nodes) {
    nodes.forEach(n => {
      if (n.value) text += n.value + ' ';
      if (n.content) walk(n.content);
    });
  })(doc.content);
  return text.trim();
}

/* ---- SVG icons (inline, same as site) ---- */
function svgCalendar() {
  return '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
}
function svgPin() {
  return '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
}
function svgArrow() {
  return '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
}
function svgBack() {
  return '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
}

/* ============================================================
   Shared HTML fragments
   ============================================================ */
function htmlHead({ title, description, canonical, ogType, ogImage, breadcrumbs }) {
  const fallbackImg = SITE_URL + '/img/photos/empfangsbereich-ordination.jpg';
  const twitterImg = ogImage || fallbackImg;
  const ogImageTags = ogImage
    ? `  <meta property="og:image" content="${escapeAttr(ogImage)}">\n  <meta property="og:image:type" content="image/jpeg">\n  <meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="630">\n  <meta property="og:image:alt" content="${escapeAttr(title)}">`
    : `  <meta property="og:image" content="${escapeAttr(fallbackImg)}">\n  <meta property="og:image:type" content="image/jpeg">\n  <meta property="og:image:width" content="2102">\n  <meta property="og:image:height" content="1402">\n  <meta property="og:image:alt" content="Empfangsbereich der kardiologischen Ordination Dr. Thomas Pap in Graz">`;

  const breadcrumbsLd = breadcrumbs && breadcrumbs.length
    ? `\n  <script type="application/ld+json">\n${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: breadcrumbs.map((b, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: b.name,
          item: b.url,
        })),
      }, null, 2)}\n  </script>`
    : '';

  return `<!DOCTYPE html>
<html lang="de-AT">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- SEO -->
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${escapeAttr(canonical)}">

  <!-- Open Graph -->
  <meta property="og:type" content="${ogType || 'website'}">
  <meta property="og:title" content="${escapeAttr(title)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:url" content="${escapeAttr(canonical)}">
  <meta property="og:locale" content="de_AT">
  <meta property="og:site_name" content="Dr. med. Thomas Pap">
${ogImageTags}

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(title)}">
  <meta name="twitter:description" content="${escapeAttr(description)}">
  <meta name="twitter:image" content="${escapeAttr(twitterImg)}">

  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <link rel="apple-touch-icon" sizes="180x180" href="/img/icons/logo.png">
  <meta name="theme-color" content="#1a2744">
  <meta name="copyright" content="Dr. med. Thomas Pap">
  <meta name="audience" content="Patientinnen und Patienten in Graz und Steiermark">
  <meta name="page-topic" content="Kardiologie, Innere Medizin, Wahlarzt-Ordination">
  <meta name="revisit-after" content="14 days">
  <meta http-equiv="expires" content="14 days">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">${breadcrumbsLd}`;
}

function headerNav(activePage) {
  function activeClass(page) {
    return page === activePage ? ' main-nav__link--active' : '';
  }
  function ariaCurrent(page) {
    return page === activePage ? ' aria-current="page"' : '';
  }
  return `
  <a href="#main-content" class="skip-link">Zum Hauptinhalt springen</a>

  <header class="site-header" role="banner">
    <div class="container">
      <a href="/" class="logo" aria-label="Zur Startseite von Dr. med. Thomas Pap">
        <img src="/img/icons/logo.png" alt="Logo Dr. med. Thomas Pap – Kardiologie Graz" class="logo__img" width="42" height="42">
        <span class="logo__text">
          <span class="logo__name">Dr. med. Thomas Pap</span>
          <span class="logo__subtitle">Innere Medizin &amp; Kardiologie</span>
        </span>
      </a>
      <nav class="main-nav" aria-label="Hauptnavigation">
        <ul class="main-nav__list">
          <li><a href="/" class="main-nav__link${activeClass('home')}">Startseite</a></li>
          <li><a href="/ueber-mich/" class="main-nav__link${activeClass('about')}">Über mich</a></li>
          <li><a href="/leistungen/" class="main-nav__link${activeClass('services')}">Leistungen</a></li>
          <li><a href="/blog/" class="main-nav__link${activeClass('blog')}"${ariaCurrent('blog')}>Blog</a></li>
          <li><a href="/faq/" class="main-nav__link${activeClass('faq')}">FAQ</a></li>
          <li><a href="/termin/" class="main-nav__link${activeClass('booking')}">Termin buchen</a></li>
          <li><a href="/kontakt/" class="main-nav__link${activeClass('contact')}">Kontakt</a></li>
        </ul>
      </nav>
      <button class="burger" aria-label="Menü öffnen" aria-expanded="false" aria-controls="mobile-nav">
        <span class="burger__line"></span>
        <span class="burger__line"></span>
        <span class="burger__line"></span>
      </button>
    </div>
  </header>

  <nav class="mobile-nav" id="mobile-nav" aria-label="Mobile Navigation" aria-hidden="true">
    <ul class="mobile-nav__list">
      <li><a href="/" class="mobile-nav__link">Startseite</a></li>
      <li><a href="/ueber-mich/" class="mobile-nav__link">Über mich</a></li>
      <li><a href="/leistungen/" class="mobile-nav__link">Leistungen</a></li>
      <li><a href="/blog/" class="mobile-nav__link"${ariaCurrent('blog')}>Blog</a></li>
      <li><a href="/faq/" class="mobile-nav__link">FAQ</a></li>
      <li><a href="/termin/" class="mobile-nav__link">Termin buchen</a></li>
      <li><a href="/kontakt/" class="mobile-nav__link">Kontakt</a></li>
    </ul>
  </nav>`;
}

function footer() {
  return `
  <footer class="site-footer" role="contentinfo">
    <div class="container">
      <div class="footer-grid">
        <div>
          <p class="footer__heading">Dr. med. Thomas Pap</p>
          <p class="footer__text">
            Facharzt für Innere Medizin und Kardiologie<br>
            Wahlarzt-Ordination in Graz
          </p>
          <p class="footer__text" style="margin-top: var(--sp-md);">
            <a href="tel:+436764501256">+43 676 450 125 6</a><br>
            <a href="#" class="js-mail" data-u="mail" data-d="kardiologie-pap.at" rel="nofollow">mail (at) kardiologie-pap.at</a>
          </p>
        </div>
        <div>
          <p class="footer__heading">Navigation</p>
          <ul class="footer__nav-list">
            <li><a href="/" class="footer__nav-link">Startseite</a></li>
            <li><a href="/ueber-mich/" class="footer__nav-link">Über mich</a></li>
            <li><a href="/leistungen/" class="footer__nav-link">Leistungen</a></li>
            <li><a href="/blog/" class="footer__nav-link">Blog</a></li>
            <li><a href="/faq/" class="footer__nav-link">FAQ</a></li>
            <li><a href="/termin/" class="footer__nav-link">Termin buchen</a></li>
            <li><a href="/kontakt/" class="footer__nav-link">Kontakt</a></li>
          </ul>
        </div>
        <div>
          <p class="footer__heading">Öffnungszeiten</p>
          <p class="footer__text">
            Do: 16:00 – 21:00 Uhr<br>
            
            <em>Termine nach Vereinbarung</em>
          </p>
        </div>
      </div>
      <div class="footer__bottom">
        <span>&copy; ${new Date().getFullYear()} Dr. med. Thomas Pap. Alle Rechte vorbehalten.</span>
        <span>
          <a href="/impressum/">Impressum</a> &middot;
          <a href="/datenschutz/">Datenschutz</a>
        </span>
      </div>
    </div>
  </footer>`;
}

function burgerScript() {
  return `
  <script>
    (function () {
      'use strict';
      var burger = document.querySelector('.burger');
      var mobileNav = document.getElementById('mobile-nav');
      var mobileLinks = mobileNav.querySelectorAll('.mobile-nav__link');
      function toggleMenu() {
        var isOpen = burger.getAttribute('aria-expanded') === 'true';
        burger.setAttribute('aria-expanded', String(!isOpen));
        burger.setAttribute('aria-label', isOpen ? 'Menü öffnen' : 'Menü schließen');
        mobileNav.setAttribute('aria-hidden', String(isOpen));
        document.body.style.overflow = isOpen ? '' : 'hidden';
      }
      burger.addEventListener('click', toggleMenu);
      mobileLinks.forEach(function (link) {
        link.addEventListener('click', function () {
          burger.setAttribute('aria-expanded', 'false');
          burger.setAttribute('aria-label', 'Menü öffnen');
          mobileNav.setAttribute('aria-hidden', 'true');
          document.body.style.overflow = '';
        });
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') {
          toggleMenu(); burger.focus();
        }
      });
      var header = document.querySelector('.site-header');
      window.addEventListener('scroll', function () {
        header.classList.toggle('scrolled', window.scrollY > 10);
      }, { passive: true });
      document.querySelectorAll('a.js-mail').forEach(function(a){var u=a.getAttribute('data-u'),d=a.getAttribute('data-d');if(!u||!d)return;var addr=u+String.fromCharCode(64)+d;a.href='mailto:'+addr;a.textContent=addr;});
    })();
  </script>`;
}

/* ============================================================
   Generate: blog/index.html  (listing page)
   ============================================================ */
function buildListingPage(posts, assetsMap) {
  const cards = posts.map(entry => {
    const f = entry.fields;
    const slug = slugify(f.titel || entry.sys.id);
    const postUrl = `/blog/${slug}/`;
    const plainBody = getBodyPlain(f);
    const excerpt = plainBody.substring(0, 160) + (plainBody.length > 160 ? '...' : '');
    const ortStr = getOrtString(f.ort);

    let imgUrl = null;
    if (f.thumbnail && f.thumbnail.sys) {
      const asset = assetsMap[f.thumbnail.sys.id];
      if (asset && asset.fields && asset.fields.file) {
        imgUrl = 'https:' + asset.fields.file.url + '?w=600&h=338&fit=fill&q=80';
      }
    }

    const thumbHtml = imgUrl
      ? `<img src="${escapeAttr(imgUrl)}" alt="${escapeAttr('Beitragsbild: ' + (f.titel || 'Blogbeitrag'))}" loading="lazy">`
      : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--clr-gray-400);"><svg width="48" height="48" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>';

    return `
          <a href="${escapeAttr(postUrl)}" class="blog-card" aria-label="${escapeAttr(f.titel || '')}">
            <div class="blog-card__thumb">${thumbHtml}</div>
            <div class="blog-card__body">
              <div class="blog-card__meta">
                <span>${svgCalendar()} ${formatDate(f.datum || entry.sys.createdAt)}</span>
                ${ortStr ? `<span>${svgPin()} ${escapeHtml(ortStr)}</span>` : ''}
              </div>
              ${f.kategorie ? `<span class="blog-card__category">${escapeHtml(f.kategorie)}</span>` : ''}
              <h3 class="blog-card__title">${escapeHtml(f.titel || '')}</h3>
              <p class="blog-card__excerpt">${escapeHtml(excerpt)}</p>
              <span class="blog-card__read-more">Weiterlesen ${svgArrow()}</span>
            </div>
          </a>`;
  }).join('\n');

  const emptyState = posts.length === 0
    ? `<div class="blog-state">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          <p>Noch keine Beiträge vorhanden.</p>
        </div>`
    : '';

  return `${htmlHead({
    title: 'Blog – Dr. med. Thomas Pap | Kardiologe in Graz',
    description: 'Aktuelles aus der Kardiologie: Fachbeiträge, Gesundheitstipps und Neuigkeiten aus der Ordination von Dr. med. Thomas Pap in Graz.',
    canonical: SITE_URL + '/blog/',
    ogType: 'website',
    breadcrumbs: [
      { name: 'Startseite', url: SITE_URL + '/' },
      { name: 'Blog', url: SITE_URL + '/blog/' },
    ],
  })}

  <style>
    .blog-grid {
      display: grid;
      gap: var(--sp-xl);
    }
    .blog-card {
      display: grid;
      background: var(--clr-white);
      border: 1px solid var(--clr-gray-200);
      border-radius: var(--border-radius-lg);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
      transition: box-shadow var(--transition), transform var(--transition);
      cursor: pointer;
      text-decoration: none;
      color: inherit;
    }
    .blog-card:hover {
      box-shadow: var(--shadow-md);
      transform: translateY(-2px);
    }
    .blog-card__thumb {
      width: 100%;
      aspect-ratio: 16 / 9;
      overflow: hidden;
      background: var(--clr-gray-100);
    }
    .blog-card__thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .blog-card__body {
      padding: var(--sp-lg);
      display: flex;
      flex-direction: column;
      gap: var(--sp-sm);
    }
    .blog-card__meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--sp-sm) var(--sp-md);
      font-size: var(--fs-sm);
      color: var(--clr-gray-400);
    }
    .blog-card__meta span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .blog-card__meta svg {
      width: 14px;
      height: 14px;
      stroke: var(--clr-gray-400);
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .blog-card__category {
      display: inline-block;
      background: var(--clr-blue-light);
      color: var(--clr-blue);
      font-size: var(--fs-sm);
      font-weight: var(--fw-semibold);
      padding: 2px 10px;
      border-radius: 100px;
      width: fit-content;
    }
    .blog-card__title {
      font-family: var(--ff-heading);
      font-size: var(--fs-xl);
      font-weight: var(--fw-bold);
      color: var(--clr-navy);
      line-height: var(--lh-tight);
    }
    .blog-card__excerpt {
      font-size: var(--fs-base);
      color: var(--clr-text-light);
      line-height: var(--lh-normal);
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .blog-card__read-more {
      font-size: var(--fs-sm);
      font-weight: var(--fw-semibold);
      color: var(--clr-accent);
      margin-top: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .blog-card__read-more svg {
      width: 16px;
      height: 16px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .blog-state {
      text-align: center;
      padding: var(--sp-3xl) var(--sp-lg);
      color: var(--clr-gray-400);
    }
    .blog-state svg {
      width: 64px;
      height: 64px;
      stroke: var(--clr-gray-200);
      fill: none;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
      margin-bottom: var(--sp-md);
    }
    .blog-state p { font-size: var(--fs-lg); }
    @media (min-width: 600px) {
      .blog-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (min-width: 900px) {
      .blog-grid { grid-template-columns: repeat(3, 1fr); }
    }
  </style>
</head>
<body>
${headerNav('blog')}

  <main id="main-content">
    <section class="hero hero--compact" aria-labelledby="page-title">
      <div class="container">
        <div class="hero__content">
          <span class="hero__overline">Blog</span>
          <h1 id="page-title" class="hero__title">Aktuelles aus der Kardiologie</h1>
          <p class="hero__text">
            Fachbeiträge, Gesundheitstipps und Neuigkeiten aus meiner Ordination.
          </p>
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="blog-listing-title">
      <div class="container">
        <h2 id="blog-listing-title" class="sr-only">Alle Beiträge</h2>
        ${posts.length > 0 ? `<div class="blog-grid">${cards}\n        </div>` : emptyState}
      </div>
    </section>
  </main>
${footer()}
${burgerScript()}
</body>
</html>`;
}

/* ============================================================
   Generate: blog/<slug>/index.html  (single post)
   ============================================================ */
function buildPostPage(entry, assetsMap) {
  const f = entry.fields;
  const title = f.titel || 'Beitrag';
  const slug = slugify(title);
  const canonical = `${SITE_URL}/blog/${slug}/`;
  const plainBody = getBodyPlain(f);
  const description = plainBody.substring(0, 155).replace(/\n/g, ' ') + (plainBody.length > 155 ? '...' : '');
  const bodyHtml = getBodyHtml(f);
  const ortStr = getOrtString(f.ort);
  const dateDisplay = formatDate(f.datum || entry.sys.createdAt);
  const dateISO = f.datum || entry.sys.createdAt;

  let imgUrl = null;
  let ogImage = null;
  if (f.thumbnail && f.thumbnail.sys) {
    const asset = assetsMap[f.thumbnail.sys.id];
    if (asset && asset.fields && asset.fields.file) {
      imgUrl = 'https:' + asset.fields.file.url;
      ogImage = imgUrl + '?w=1200&h=630&fit=fill&q=80';
    }
  }

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description: description,
    datePublished: dateISO,
    dateModified: entry.sys.updatedAt,
    url: canonical,
    ...(ogImage ? { image: ogImage } : {}),
    author: {
      '@type': 'Person',
      name: 'Dr. med. Thomas Pap',
      jobTitle: 'Facharzt für Innere Medizin und Kardiologie',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Dr. med. Thomas Pap – Kardiologie Graz',
    },
  });

  const shareUrl = encodeURIComponent(canonical);
  const shareTitle = encodeURIComponent(title);

  return `${htmlHead({
    title: title + ' – Dr. med. Thomas Pap | Kardiologe in Graz',
    description,
    canonical,
    ogType: 'article',
    ogImage,
    breadcrumbs: [
      { name: 'Startseite', url: SITE_URL + '/' },
      { name: 'Blog', url: SITE_URL + '/blog/' },
      { name: title, url: canonical },
    ],
  })}

  <script type="application/ld+json">${jsonLd}</script>

  <style>
    .post-article { max-width: 780px; margin: 0 auto; }
    .post-hero {
      width: 100%; aspect-ratio: 16 / 9; overflow: hidden;
      border-radius: var(--border-radius-lg); background: var(--clr-gray-100);
      margin-bottom: var(--sp-xl);
    }
    .post-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .post-meta {
      display: flex; flex-wrap: wrap; gap: var(--sp-sm) var(--sp-md);
      font-size: var(--fs-sm); color: var(--clr-gray-400); margin-bottom: var(--sp-md);
    }
    .post-meta span { display: inline-flex; align-items: center; gap: 4px; }
    .post-meta svg {
      width: 14px; height: 14px; stroke: var(--clr-gray-400);
      fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
    }
    .post-category {
      display: inline-block; background: var(--clr-blue-light); color: var(--clr-blue);
      font-size: var(--fs-sm); font-weight: var(--fw-semibold);
      padding: 2px 10px; border-radius: 100px;
    }
    .post-title {
      font-family: var(--ff-heading); font-size: clamp(1.5rem, 4vw, 2.25rem);
      font-weight: var(--fw-bold); color: var(--clr-navy);
      line-height: var(--lh-tight); margin-bottom: var(--sp-xl);
    }
    .post-body { color: var(--clr-text); line-height: var(--lh-loose); font-size: var(--fs-base); }
    .post-body h2, .post-body h3 { margin-top: var(--sp-xl); margin-bottom: var(--sp-sm); }
    .post-body p { margin-bottom: var(--sp-md); }
    .post-body ul, .post-body ol { margin-bottom: var(--sp-md); padding-left: var(--sp-xl); list-style: disc; }
    .post-body ol { list-style: decimal; }
    .post-body blockquote {
      border-left: 3px solid var(--clr-accent); padding-left: var(--sp-md);
      margin: var(--sp-lg) 0; color: var(--clr-text-light); font-style: italic;
    }
    .post-body img { max-width: 100%; height: auto; border-radius: var(--border-radius); margin: var(--sp-md) 0; }
    .post-body a { color: var(--clr-accent); text-decoration: underline; }
    .post-back {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: var(--fs-sm); font-weight: var(--fw-semibold);
      color: var(--clr-accent); text-decoration: none; margin-bottom: var(--sp-xl);
      transition: color var(--transition);
    }
    .post-back:hover { color: var(--clr-accent-hover); }
    .post-back svg {
      width: 16px; height: 16px; stroke: currentColor; fill: none;
      stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    }
    .post-share {
      margin-top: var(--sp-2xl); padding-top: var(--sp-xl);
      border-top: 1px solid var(--clr-gray-200);
      display: flex; align-items: center; gap: var(--sp-md); flex-wrap: wrap;
    }
    .post-share__label { font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--clr-gray-400); }
    .post-share__link {
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border-radius: 50%;
      border: 1px solid var(--clr-gray-200); color: var(--clr-gray-600);
      text-decoration: none; transition: background var(--transition), color var(--transition);
      background: none; cursor: pointer;
    }
    .post-share__link:hover { background: var(--clr-blue-light); color: var(--clr-blue); }
    .post-share__link svg {
      width: 16px; height: 16px; stroke: currentColor; fill: none;
      stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    }
  </style>
</head>
<body>
${headerNav('blog')}

  <main id="main-content">
    <section class="section">
      <div class="container">
        <article class="post-article">
          <a href="/blog/" class="post-back">
            ${svgBack()} Alle Beiträge
          </a>

          ${imgUrl ? `<div class="post-hero"><img src="${escapeAttr(imgUrl)}?w=780&h=440&fit=fill&q=85" alt="${escapeAttr('Beitragsbild: ' + title)}"></div>` : ''}

          <div class="post-meta">
            <span>${svgCalendar()} ${dateDisplay}</span>
            ${ortStr ? `<span>${svgPin()} ${escapeHtml(ortStr)}</span>` : ''}
            ${f.kategorie ? `<span class="post-category">${escapeHtml(f.kategorie)}</span>` : ''}
          </div>

          <h1 class="post-title">${escapeHtml(title)}</h1>

          <div class="post-body">
            ${bodyHtml}
          </div>

          <div class="post-share">
            <span class="post-share__label">Teilen:</span>
            <a class="post-share__link" href="mailto:?subject=${shareTitle}&body=${shareUrl}" title="Per E-Mail teilen" aria-label="Per E-Mail teilen">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </a>
            <a class="post-share__link" href="https://wa.me/?text=${shareTitle}%20${shareUrl}" target="_blank" rel="noopener" title="Auf WhatsApp teilen" aria-label="Auf WhatsApp teilen">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            </a>
            <button class="post-share__link" onclick="navigator.clipboard.writeText('${canonical}').then(function(){alert('Link kopiert!')})" title="Link kopieren" aria-label="Link kopieren">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
        </article>
      </div>
    </section>
  </main>
${footer()}
${burgerScript()}
</body>
</html>`;
}

/* ============================================================
   Main build
   ============================================================ */
async function main() {
  console.log('Fetching posts from Contentful...');

  const apiUrl = `https://cdn.contentful.com/spaces/${CF.spaceId}/environments/master/entries`
    + `?access_token=${CF.accessToken}`
    + `&content_type=${CF.contentType}`
    + `&order=-sys.createdAt`
    + `&include=1`;

  const data = await fetchJSON(apiUrl);

  // Build assets map
  const assetsMap = {};
  if (data.includes && data.includes.Asset) {
    data.includes.Asset.forEach(asset => {
      assetsMap[asset.sys.id] = asset;
    });
  }

  const posts = data.items || [];
  console.log(`Found ${posts.length} published post(s).`);

  // Ensure output directory
  const blogDir = path.join(__dirname, 'blog');
  if (!fs.existsSync(blogDir)) fs.mkdirSync(blogDir, { recursive: true });

  // Clean previous post folders (but keep blog/index.html for now)
  const existing = fs.readdirSync(blogDir);
  for (const name of existing) {
    const full = path.join(blogDir, name);
    if (fs.statSync(full).isDirectory()) {
      fs.rmSync(full, { recursive: true });
    }
  }

  // 1. Generate listing page
  const listingHtml = buildListingPage(posts, assetsMap);
  fs.writeFileSync(path.join(blogDir, 'index.html'), listingHtml, 'utf-8');
  console.log('  -> blog/index.html');

  // 2. Generate individual post pages
  const slugTracker = {};
  for (const entry of posts) {
    let slug = slugify(entry.fields.titel || entry.sys.id);
    // Handle duplicate slugs
    if (slugTracker[slug]) {
      slugTracker[slug]++;
      slug = slug + '-' + slugTracker[slug];
    } else {
      slugTracker[slug] = 1;
    }

    const postDir = path.join(blogDir, slug);
    fs.mkdirSync(postDir, { recursive: true });
    const postHtml = buildPostPage(entry, assetsMap);
    fs.writeFileSync(path.join(postDir, 'index.html'), postHtml, 'utf-8');
    console.log(`  -> blog/${slug}/index.html`);
  }

  console.log('\nBuild complete!');
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
